import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { CloudAccount } from '@/modules/cloud-account/types';
import { AnthropicChatRequest } from '@/modules/proxy-gateway/server/common/interfaces/request-interfaces';
import { sanitizeAnthropicOfficialRequest } from './anthropic-model-helper';
import { AnthropicOAuthRefresher } from './anthropic-oauth-refresher';
import {
  UpstreamAuthError,
  UpstreamExecutionResult,
  UpstreamRateLimitError,
  UpstreamRequestFailedError,
} from '../upstream.types';

@Injectable()
export class AnthropicUpstreamService {
  private readonly logger = new Logger(AnthropicUpstreamService.name);
  private readonly baseUrl = 'https://api.anthropic.com/v1';

  /**
   * Execute messages request against official Anthropic API
   */
  public async executeMessages(
    req: AnthropicChatRequest,
    account: CloudAccount,
  ): Promise<UpstreamExecutionResult> {
    if (AnthropicOAuthRefresher.shouldRefresh(account)) {
      await AnthropicOAuthRefresher.refreshAccessToken(account);
    }

    const isStream = Boolean(req.stream);
    const url = `${this.baseUrl}/messages`;
    const headers = this.buildHeaders(account);
    const body = sanitizeAnthropicOfficialRequest(req);

    try {
      if (isStream) {
        const response = await axios.post(url, body, {
          headers,
          responseType: 'stream',
          timeout: 120_000,
        });

        return {
          isStream: true,
          stream: response.data,
          status: response.status,
          headers: response.headers as Record<string, string | string[]>,
        };
      } else {
        const response = await axios.post(url, body, {
          headers,
          timeout: 120_000,
        });

        return {
          isStream: false,
          data: response.data,
          status: response.status,
          headers: response.headers as Record<string, string | string[]>,
        };
      }
    } catch (err: unknown) {
      this.handleAxiosError(err, account, 'anthropic-messages');
    }
  }

  /**
   * Count tokens against official Anthropic API
   */
  public async countTokens(
    req: AnthropicChatRequest,
    account: CloudAccount,
  ): Promise<{ input_tokens: number }> {
    if (AnthropicOAuthRefresher.shouldRefresh(account)) {
      await AnthropicOAuthRefresher.refreshAccessToken(account);
    }

    const url = `${this.baseUrl}/messages/count_tokens`;
    const headers = this.buildHeaders(account);
    const body = sanitizeAnthropicOfficialRequest(req);

    try {
      const response = await axios.post(url, body, {
        headers,
        timeout: 30_000,
      });

      return response.data as { input_tokens: number };
    } catch (err: unknown) {
      this.handleAxiosError(err, account, 'anthropic-count-tokens');
    }
  }

  private buildHeaders(account: CloudAccount): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31,thinking-2025-01-24,output-128k-2025-02-19',
    };

    const oauthToken =
      account.claude_oauth?.accessToken ||
      account.claudeAiOauth?.accessToken ||
      account.token?.access_token;

    if (oauthToken && (oauthToken.startsWith('sk-ant-oat01-') || account.auth_type === 'cli_oauth')) {
      headers['Authorization'] = `Bearer ${oauthToken}`;
    } else if (account.api_key) {
      if (account.api_key.startsWith('sk-ant-oat01-')) {
        headers['Authorization'] = `Bearer ${account.api_key}`;
      } else {
        headers['x-api-key'] = account.api_key;
      }
    } else if (oauthToken) {
      headers['Authorization'] = `Bearer ${oauthToken}`;
    } else {
      throw new UpstreamAuthError('anthropic', account.id, 'No API key or OAuth access token found on account');
    }

    return headers;
  }

  private handleAxiosError(err: unknown, account: CloudAccount, operation: string): never {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const data = err.response?.data;
      const retryAfterHeader = err.response?.headers?.['retry-after'];
      let retryAfterMs = 60_000;

      if (retryAfterHeader) {
        const parsed = Number(retryAfterHeader);
        if (!isNaN(parsed) && parsed > 0) {
          retryAfterMs = parsed * 1000;
        }
      }

      this.logger.warn(`Anthropic [${operation}] failed (Status: ${status}, Account: ${account.id})`);

      if (status === 429 || status === 529) {
        throw new UpstreamRateLimitError(
          'anthropic',
          account.id,
          retryAfterMs,
          `Anthropic rate limit or overloaded: status ${status}`,
        );
      }

      if (status === 401 || status === 403) {
        throw new UpstreamAuthError(
          'anthropic',
          account.id,
          `Anthropic auth failed (${status}): ${JSON.stringify(data)}`,
        );
      }

      throw new UpstreamRequestFailedError(
        'anthropic',
        account.id,
        status ?? 500,
        data,
        `Anthropic upstream error: ${err.message}`,
      );
    }

    throw err as Error;
  }
}
