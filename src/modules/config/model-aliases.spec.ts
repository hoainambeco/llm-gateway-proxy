import {
  migrateLegacyModelAliases,
  getConfiguredModelMapping,
} from './model-aliases';
import type { ProxyConfig } from './types';

describe('model-aliases', () => {
  const baseConfig: ProxyConfig = {
    port: 8080,
    model_aliases: [],
    custom_mapping: {},
    anthropic_mapping: {},
    openai_mapping: {},
  } as any;

  describe('migrateLegacyModelAliases', () => {
    it('folds anthropic_mapping and custom_mapping into model_aliases', () => {
      const config: ProxyConfig = {
        ...baseConfig,
        anthropic_mapping: {
          'claude-alias': 'claude-target',
          'shared-alias': 'anthropic-target',
        },
        custom_mapping: {
          'custom-alias': 'custom-target',
          'shared-alias': 'custom-target', // should be ignored in favor of anthropic entry
        },
      };

      const migrated = migrateLegacyModelAliases(config);

      expect(migrated.model_aliases).toEqual([
        { alias: 'claude-alias', target: 'claude-target', enabled: true },
        { alias: 'shared-alias', target: 'anthropic-target', enabled: true },
        { alias: 'custom-alias', target: 'custom-target', enabled: true },
      ]);
      expect(migrated.anthropic_mapping).toEqual({});
      expect(migrated.custom_mapping).toEqual({
        'claude-alias': 'claude-target',
        'shared-alias': 'anthropic-target',
        'custom-alias': 'custom-target',
      });
    });

    it('preserves existing model_aliases and respects enabled: false', () => {
      const config: ProxyConfig = {
        ...baseConfig,
        model_aliases: [
          { alias: 'disabled-route', target: 'target-1', enabled: false },
          { alias: 'active-route', target: 'target-2', enabled: true },
        ],
      };

      const migrated = migrateLegacyModelAliases(config);

      expect(migrated.model_aliases).toEqual([
        { alias: 'disabled-route', target: 'target-1', enabled: false },
        { alias: 'active-route', target: 'target-2', enabled: true },
      ]);
      // Disabled route is omitted from legacy projection
      expect(migrated.custom_mapping).toEqual({
        'active-route': 'target-2',
      });
    });
  });

  describe('getConfiguredModelMapping', () => {
    it('returns key-value mapping of only enabled routes', () => {
      const config: ProxyConfig = {
        ...baseConfig,
        model_aliases: [
          { alias: 'm1', target: 'target-1', enabled: true },
          { alias: 'm2', target: 'target-2', enabled: false },
          { alias: 'm3', target: 'target-3', enabled: true },
        ],
      };

      const mapping = getConfiguredModelMapping(config);
      expect(mapping).toEqual({
        m1: 'target-1',
        m3: 'target-3',
      });
    });
  });
});
