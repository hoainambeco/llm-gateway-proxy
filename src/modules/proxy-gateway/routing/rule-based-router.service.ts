import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import {
  RoutingConfig,
  UpstreamProviderTarget,
  UpstreamProviderType,
} from './routing.types';

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  rules: [
    {
      pattern: '^(claude-3-7-sonnet|claude-3-5-sonnet|claude-sonnet|claude-opus|claude-haiku|claude-)',
      pipeline: ['google', 'anthropic_api', 'anthropic_oauth', 'anthropic_web'],
      description: 'Claude models: Prioritize Antigravity (free quota), then fallback to Anthropic pool',
    },
    {
      pattern: '^(gpt-4o|o1|o3|codex|gpt-4|gpt-3|chatgpt)',
      pipeline: ['copilot', 'openai_api', 'chatgpt_web', 'google'],
      description: 'Codex / GPT models: Prioritize Copilot & OpenAI, fallback to Google transpile',
    },
    {
      pattern: '^(gemini-|imagen)',
      pipeline: ['google'],
      description: 'Google Native: Direct to Google Antigravity',
    },
  ],
  default_pipeline: ['google', 'anthropic_api', 'copilot', 'openai_api'],
};

@Injectable()
export class RuleBasedRouterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuleBasedRouterService.name);
  private configPath: string;
  private currentConfig: RoutingConfig = DEFAULT_ROUTING_CONFIG;
  private fileWatcher?: fs.FSWatcher;

  constructor() {
    this.configPath = path.resolve(process.env.ROUTING_CONFIG_PATH || './routing.json');
  }

  onModuleInit(): void {
    this.loadConfig();
    this.watchConfigFile();
  }

  onModuleDestroy(): void {
    if (this.fileWatcher) {
      try {
        this.fileWatcher.close();
      } catch {
        // Ignore watcher close errors
      }
    }
  }

  public getConfig(): RoutingConfig {
    return this.currentConfig;
  }

  /**
   * Resolves a model ID to an ordered pipeline of concrete UpstreamProviderTypes.
   */
  public resolvePipeline(model: string): UpstreamProviderType[] {
    const cleanModel = (model || '').trim().replace(/^models\//i, '');
    let matchedTargets: UpstreamProviderTarget[] | undefined;

    for (const rule of this.currentConfig.rules) {
      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(cleanModel)) {
          matchedTargets = rule.pipeline;
          break;
        }
      } catch (err) {
        this.logger.warn(`Invalid regex pattern in routing rule: "${rule.pattern}"`, err);
      }
    }

    const targets = matchedTargets && matchedTargets.length > 0
      ? matchedTargets
      : this.currentConfig.default_pipeline;

    return this.expandToConcreteProviders(targets);
  }

  /**
   * Expand generic targets (like 'anthropic', 'openai') into concrete provider types.
   */
  private expandToConcreteProviders(targets: UpstreamProviderTarget[]): UpstreamProviderType[] {
    const result: UpstreamProviderType[] = [];
    const seen = new Set<UpstreamProviderType>();

    for (const target of targets) {
      let expanded: UpstreamProviderType[];
      if (target === 'anthropic') {
        expanded = ['anthropic_api', 'anthropic_oauth', 'anthropic_web'];
      } else if (target === 'openai') {
        expanded = ['copilot', 'openai_api', 'chatgpt_web'];
      } else {
        expanded = [target];
      }

      for (const p of expanded) {
        if (!seen.has(p)) {
          seen.add(p);
          result.push(p);
        }
      }
    }

    return result;
  }

  public async saveConfig(config: RoutingConfig): Promise<void> {
    this.currentConfig = config;
    try {
      await fs.promises.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
      this.logger.log(`Saved updated routing configuration to ${this.configPath}`);
    } catch (err) {
      this.logger.error(`Failed to save routing configuration to ${this.configPath}`, err);
      throw err;
    }
  }

  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.rules)) {
          this.currentConfig = {
            rules: parsed.rules,
            default_pipeline: Array.isArray(parsed.default_pipeline)
              ? parsed.default_pipeline
              : DEFAULT_ROUTING_CONFIG.default_pipeline,
          };
          this.logger.log(`Loaded ${this.currentConfig.rules.length} custom routing rules from ${this.configPath}`);
          return;
        }
      }
    } catch (err) {
      this.logger.warn(`Failed reading ${this.configPath}, using default routing rules`, err);
    }

    // If file doesn't exist, create it with default config
    this.currentConfig = DEFAULT_ROUTING_CONFIG;
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(DEFAULT_ROUTING_CONFIG, null, 2), 'utf-8');
      this.logger.log(`Initialized default routing config at ${this.configPath}`);
    } catch (err) {
      this.logger.warn(`Could not create default ${this.configPath} file`, err);
    }
  }

  private watchConfigFile(): void {
    try {
      if (!fs.existsSync(this.configPath)) {
        return;
      }
      this.fileWatcher = fs.watch(this.configPath, (eventType) => {
        if (eventType === 'change' || eventType === 'rename') {
          this.logger.log(`Detected change in ${this.configPath}, reloading routing configuration...`);
          setTimeout(() => this.loadConfig(), 200);
        }
      });
    } catch (err) {
      this.logger.warn(`Unable to watch ${this.configPath} for changes`, err);
    }
  }
}
