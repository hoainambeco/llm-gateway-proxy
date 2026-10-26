import {
  GeminiToolConfigAliasesSchema,
  toSnakeToolConfig,
  normalizeGeminiToolConfigAliases,
  canCacheGeminiToolConfig,
} from './GeminiToolConfigCompat';

describe('GeminiToolConfigCompat', () => {
  describe('toSnakeToolConfig', () => {
    it('converts camelCase toolConfig to snake_case structure', () => {
      const config = {
        functionCallingConfig: {
          mode: 'AUTO',
          allowedFunctionNames: ['search', 'fetch'],
        },
        includeServerSideToolInvocations: true,
      };

      const snake = toSnakeToolConfig(config);
      expect(snake).toEqual({
        function_calling_config: {
          mode: 'AUTO',
          allowed_function_names: ['search', 'fetch'],
        },
        include_server_side_tool_invocations: true,
      });
    });

    it('handles empty or partial functionCallingConfig', () => {
      expect(toSnakeToolConfig({})).toEqual({});
      expect(toSnakeToolConfig({ functionCallingConfig: {} })).toEqual({
        function_calling_config: {},
      });
    });
  });

  describe('normalizeGeminiToolConfigAliases', () => {
    it('leaves config unchanged when tools is undefined', () => {
      const req = {
        toolConfig: { functionCallingConfig: { mode: 'ANY' } },
      };
      const res = normalizeGeminiToolConfigAliases(req as any);
      expect(res.toolConfig).toBe(req.toolConfig);
      expect(res.tool_config).toBeUndefined();
    });

    it('supplies defaults with VALIDATED mode and includeServerSideToolInvocations when tools are present', () => {
      const req = {
        tools: [{ functionDeclarations: [] }],
      };
      const res = normalizeGeminiToolConfigAliases(req as any);
      expect(res.toolConfig).toEqual({
        functionCallingConfig: { mode: 'VALIDATED' },
        includeServerSideToolInvocations: true,
      });
      expect(res.tool_config).toEqual({
        function_calling_config: { mode: 'VALIDATED' },
        include_server_side_tool_invocations: true,
      });
    });
  });

  describe('canCacheGeminiToolConfig', () => {
    it('returns true when toolConfig is missing and snake is undefined', () => {
      expect(canCacheGeminiToolConfig({})).toBe(true);
    });

    it('returns false when toolConfig is missing but snake is defined', () => {
      expect(canCacheGeminiToolConfig({ tool_config: {} as any })).toBe(false);
    });

    it('returns true when canonical config is valid and snake matches or is undefined', () => {
      const validConfig = {
        functionCallingConfig: { mode: 'AUTO' },
        includeServerSideToolInvocations: true,
      };
      expect(canCacheGeminiToolConfig({ toolConfig: validConfig })).toBe(true);
      expect(
        canCacheGeminiToolConfig({
          toolConfig: validConfig,
          tool_config: toSnakeToolConfig(validConfig),
        }),
      ).toBe(true);
    });

    it('returns false when snake does not match converted canonical config', () => {
      const validConfig = {
        functionCallingConfig: { mode: 'AUTO' },
      };
      expect(
        canCacheGeminiToolConfig({
          toolConfig: validConfig,
          tool_config: { function_calling_config: { mode: 'NONE' } },
        }),
      ).toBe(false);
    });

    it('returns false when toolConfig contains non-canonical extra fields', () => {
      expect(
        canCacheGeminiToolConfig({
          toolConfig: {
            functionCallingConfig: { mode: 'AUTO' },
            unrecognizedExtraField: 123,
          } as any,
        }),
      ).toBe(false);
    });
  });

  describe('GeminiToolConfigAliasesSchema', () => {
    it('parses valid toolConfig and tool_config structures', () => {
      const parsed = GeminiToolConfigAliasesSchema.safeParse({
        toolConfig: {
          functionCallingConfig: { mode: 'AUTO', allowedFunctionNames: ['fn1'] },
          includeServerSideToolInvocations: true,
        },
        tool_config: {
          function_calling_config: { mode: 'AUTO', allowed_function_names: ['fn1'] },
          include_server_side_tool_invocations: true,
        },
      });
      expect(parsed.success).toBe(true);
    });
  });
});
