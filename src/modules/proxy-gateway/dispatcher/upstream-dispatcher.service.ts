import { redactSensitiveText } from '@/shared/security/sensitiveDataMasking';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RuleBasedRouterService } from '../routing/rule-based-router.service';
import {
  AnthropicChatRequest,
  OpenAIChatRequest,
} from '../server/common/interfaces/request-interfaces';
import { AccountLeaseService } from '../server/modules/account-lease/account-lease.service';
import { AnthropicUpstreamService } from '../upstreams/anthropic/anthropic-upstream.service';
import { ChatGPTWebUpstreamService } from '../upstreams/chatgpt-web/chatgpt-web-upstream.service';
import { ClaudeWebUpstreamService } from '../upstreams/claude-web/claude-web-upstream.service';
import { CopilotUpstreamService } from '../upstreams/copilot/copilot-upstream.service';
import { OpenAIToAnthropicStreamTransformer } from '../upstreams/openai/openai-to-anthropic-stream';
import { OpenAIUpstreamService } from '../upstreams/openai/openai-upstream.service';
import {
  UpstreamExecutionResult,
  UpstreamRateLimitError,
} from '../upstreams/upstream.types';

/** Nest's Logger prints an Error as its message, so wrap the sanitized text. */
function sanitizedError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(redactSensitiveText(message));
}

@Injectable()
export class UpstreamDispatcherService {
  private readonly logger = new Logger(UpstreamDispatcherService.name);

  constructor(
    @Inject(RuleBasedRouterService)
    private readonly routerService: RuleBasedRouterService,
    @Inject(AccountLeaseService)
    private readonly accountLeaseService: AccountLeaseService,
    @Inject(AnthropicUpstreamService)
    private readonly anthropicUpstream: AnthropicUpstreamService,
    @Inject(OpenAIUpstreamService)
    private readonly openAIUpstream: OpenAIUpstreamService,
    @Inject(CopilotUpstreamService)
    private readonly copilotUpstream: CopilotUpstreamService,
    @Inject(ClaudeWebUpstreamService)
    private readonly claudeWebUpstream: ClaudeWebUpstreamService,
    @Inject(ChatGPTWebUpstreamService)
    private readonly chatgptWebUpstream: ChatGPTWebUpstreamService,
  ) {}

  /**
   * Attempts to dispatch an OpenAI chat completion to external providers according to the routing pipeline.
   * Returns true if successfully handled and written to res. Returns false if should fallback to Google.
   */
  public async dispatchChatCompletions(
    body: OpenAIChatRequest,
    res: FastifyReply,
    _req?: FastifyRequest,
  ): Promise<boolean> {
    const pipeline = this.routerService.resolvePipeline(body.model);

    for (const provider of pipeline) {
      if (provider === 'google') {
        const hasGoogle = this.accountLeaseService.getNextAccountForProvider('google', {
          model: body.model,
        });
        if (hasGoogle) {
          return false;
        }
        continue;
      }

      const account = this.accountLeaseService.getNextAccountForProvider(
        provider,
        {
          model: body.model,
        },
      );

      if (!account) {
        // No account available for this provider, continue to next provider in pipeline
        continue;
      }

      this.logger.log(
        `[Dispatcher] Routing chat completion (${body.model}) -> Provider: ${provider} (Account: ${account.email || account.id})`,
      );

      try {
        let execution: UpstreamExecutionResult | undefined;

        if (provider === 'openai_api') {
          execution = await this.openAIUpstream.executeChatCompletions(
            body,
            account,
          );
        } else if (provider === 'copilot') {
          execution = await this.copilotUpstream.executeChatCompletions(
            body,
            account,
          );
        } else if (provider === 'chatgpt_web') {
          execution = await this.chatgptWebUpstream.executeChatCompletions(
            body,
            account,
          );
        } else if (
          provider === 'anthropic_api' ||
          provider === 'anthropic_oauth'
        ) {
          // Convert OpenAI request to Anthropic
          const anthropicReq = this.convertOpenAIToAnthropic(body);
          execution = await this.anthropicUpstream.executeMessages(
            anthropicReq,
            account,
          );
        } else if (provider === 'anthropic_web') {
          const anthropicReq = this.convertOpenAIToAnthropic(body);
          execution = await this.claudeWebUpstream.executeMessages(
            anthropicReq,
            account,
          );
        }

        if (execution) {
          this.writeUpstreamResponse(res, execution);
          return true;
        }
      } catch (err) {
        if (err instanceof UpstreamRateLimitError) {
          this.accountLeaseService.reportProviderRateLimit(
            err.accountId,
            provider,
            err.retryAfterMs,
          );
          this.logger.warn(
            `[Dispatcher] Provider ${provider} hit rate-limit (429/529). Failing over to next provider in pipeline...`,
          );
          continue; // Failover to next provider!
        }
        this.logger.error(
          `[Dispatcher] Provider ${provider} failed with error:`,
          sanitizedError(err),
        );
        continue; // Failover to next provider!
      }
    }

    return false; // Fallback to Google if all external providers in pipeline exhausted
  }

  /**
   * Attempts to dispatch an Anthropic messages request to external providers according to routing pipeline.
   * Returns true if successfully handled and written to res. Returns false if should fallback to Google.
   */
  public async dispatchAnthropicMessages(
    body: AnthropicChatRequest,
    res: FastifyReply,
    _req?: FastifyRequest,
  ): Promise<boolean> {
    const pipeline = this.routerService.resolvePipeline(body.model);

    for (const provider of pipeline) {
      if (provider === 'google') {
        const hasGoogle = this.accountLeaseService.getNextAccountForProvider('google', {
          model: body.model,
        });
        if (hasGoogle) {
          return false;
        }
        continue;
      }

      const account = this.accountLeaseService.getNextAccountForProvider(
        provider,
        {
          model: body.model,
        },
      );

      if (!account) {
        continue;
      }

      this.logger.log(
        `[Dispatcher] Routing Anthropic message (${body.model}) -> Provider: ${provider} (Account: ${account.email || account.id})`,
      );

      try {
        let execution: UpstreamExecutionResult | undefined;

        if (provider === 'anthropic_api' || provider === 'anthropic_oauth') {
          execution = await this.anthropicUpstream.executeMessages(
            body,
            account,
          );
        } else if (provider === 'anthropic_web') {
          execution = await this.claudeWebUpstream.executeMessages(
            body,
            account,
          );
        } else if (provider === 'copilot' || provider === 'openai_api') {
          // Convert Anthropic to OpenAI request
          const openAIReq = this.convertAnthropicToOpenAI(body);
          const openAIExec =
            provider === 'copilot'
              ? await this.copilotUpstream.executeChatCompletions(
                  openAIReq,
                  account,
                )
              : await this.openAIUpstream.executeChatCompletions(
                  openAIReq,
                  account,
                );

          if (openAIExec.isStream && openAIExec.stream) {
            const transformer = new OpenAIToAnthropicStreamTransformer(
              body.model,
            );
            const transformedStream = (
              openAIExec.stream as NodeJS.ReadableStream
            ).pipe(transformer);
            execution = {
              isStream: true,
              stream: transformedStream,
              status: openAIExec.status,
              headers: {
                'content-type': 'text/event-stream',
                'cache-control': 'no-cache',
                connection: 'keep-alive',
              },
            };
          } else {
            execution = openAIExec;
          }
        }

        if (execution) {
          this.writeUpstreamResponse(res, execution);
          return true;
        }
      } catch (err) {
        if (err instanceof UpstreamRateLimitError) {
          this.accountLeaseService.reportProviderRateLimit(
            err.accountId,
            provider,
            err.retryAfterMs,
          );
          this.logger.warn(
            `[Dispatcher] Provider ${provider} hit rate-limit (429/529). Failing over to next provider in pipeline...`,
          );
          continue;
        }
        this.logger.error(
          `[Dispatcher] Provider ${provider} failed with error:`,
          sanitizedError(err),
        );
        continue;
      }
    }

    return false;
  }

  private writeUpstreamResponse(
    res: FastifyReply,
    execution: UpstreamExecutionResult,
  ): void {
    if (execution.isStream && execution.stream) {
      res.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      res.raw.setHeader('Connection', 'keep-alive');
      res.raw.setHeader('X-Accel-Buffering', 'no');
      res.raw.writeHead(execution.status || 200);

      (execution.stream as NodeJS.ReadableStream).pipe(res.raw);
    } else {
      res.status(execution.status || 200).send(execution.data);
    }
  }

  private convertOpenAIToAnthropic(
    body: OpenAIChatRequest,
  ): AnthropicChatRequest {
    const messages: AnthropicChatRequest['messages'] = [];
    let system: string | undefined;

    for (const msg of body.messages || []) {
      if (msg.role === 'system' || msg.role === 'developer') {
        system =
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content);
      } else {
        messages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content:
            typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content),
        });
      }
    }

    return {
      model: body.model,
      messages,
      system,
      max_tokens: body.max_tokens || 4096,
      stream: body.stream,
      temperature: body.temperature,
      top_p: body.top_p,
    };
  }

  private convertAnthropicToOpenAI(
    body: AnthropicChatRequest,
  ): OpenAIChatRequest {
    const messages: OpenAIChatRequest['messages'] = [];

    if (body.system) {
      messages.push({
        role: 'system',
        content:
          typeof body.system === 'string'
            ? body.system
            : JSON.stringify(body.system),
      });
    }

    for (const msg of body.messages || []) {
      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content:
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content),
      });
    }

    return {
      model: body.model,
      messages,
      max_tokens: body.max_tokens,
      stream: body.stream,
      temperature: body.temperature,
      top_p: body.top_p,
    };
  }
}
