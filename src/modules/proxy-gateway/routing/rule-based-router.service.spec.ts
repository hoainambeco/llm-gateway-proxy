import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_ROUTING_CONFIG, RuleBasedRouterService } from './rule-based-router.service';
import { RoutingConfig } from './routing.types';

describe('RuleBasedRouterService', () => {
  const originalRoutingConfigPath = process.env.ROUTING_CONFIG_PATH;

  let tempDir: string;
  let configPath: string;
  let service: RuleBasedRouterService | undefined;

  function startService(pathToConfig = configPath): RuleBasedRouterService {
    process.env.ROUTING_CONFIG_PATH = pathToConfig;
    service = new RuleBasedRouterService();
    service.onModuleInit();
    return service;
  }

  function writeConfig(config: RoutingConfig): void {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-based-router-'));
    configPath = path.join(tempDir, 'routing.json');
  });

  afterEach(() => {
    service?.onModuleDestroy();
    service = undefined;

    if (originalRoutingConfigPath === undefined) {
      delete process.env.ROUTING_CONFIG_PATH;
    } else {
      process.env.ROUTING_CONFIG_PATH = originalRoutingConfigPath;
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads rules from the temp file and uses the first matching rule', () => {
    writeConfig({
      rules: [
        { pattern: '^special-model', pipeline: ['anthropic'] },
        { pattern: '^special', pipeline: ['google'] },
      ],
      default_pipeline: ['google'],
    });

    const router = startService();

    expect(router.resolvePipeline('special-model')).toEqual([
      'anthropic_api',
      'anthropic_oauth',
      'anthropic_web',
    ]);
    expect(router.resolvePipeline('special-other')).toEqual(['google']);
  });

  it('falls back to default_pipeline when no rule matches', () => {
    writeConfig({
      rules: [{ pattern: '^special', pipeline: ['google'] }],
      default_pipeline: ['openai', 'google'],
    });

    const router = startService();

    expect(router.resolvePipeline('unknown-model')).toEqual([
      'copilot',
      'openai_api',
      'chatgpt_web',
      'google',
    ]);
  });

  it('normalizes a models/ prefix and surrounding whitespace before matching', () => {
    writeConfig({
      rules: [{ pattern: '^special-model$', pipeline: ['google'] }],
      default_pipeline: ['anthropic_api'],
    });

    const router = startService();

    expect(router.resolvePipeline('  models/special-model  ')).toEqual(['google']);
  });

  it('uses built-in defaults without throwing when the config file is missing', () => {
    const missingPath = path.join(tempDir, 'missing-routing.json');

    const router = startService(missingPath);

    expect(router.getConfig()).toEqual(DEFAULT_ROUTING_CONFIG);
    expect(router.resolvePipeline('claude-3-5-sonnet-20241022')).toEqual([
      'google',
      'anthropic_api',
      'anthropic_oauth',
      'anthropic_web',
    ]);
    // The service writes its fallback defaults so the watched file exists afterwards.
    expect(fs.existsSync(missingPath)).toBe(true);
  });
});
