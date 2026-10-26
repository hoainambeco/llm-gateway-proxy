import axios from 'axios';
import { ProviderModelDiscoveryService } from './provider-model-discovery.service';
import type { CloudAccount } from '@/modules/cloud-account/types';

describe('ProviderModelDiscoveryService', () => {
  let service: ProviderModelDiscoveryService;

  beforeEach(() => {
    service = new ProviderModelDiscoveryService();
    jest.clearAllMocks();
  });

  describe('discoverProviderModels & Caching', () => {
    it('skips Google accounts and returns empty map if no non-google accounts exist', async () => {
      const accounts: CloudAccount[] = [
        { id: 'g-1', provider: 'google', email: 'g@test.local' } as any,
      ];

      const result = await service.discoverProviderModels(accounts);
      expect(result.size).toBe(0);
    });

    it('discovers Anthropic API models and groups by anthropic_api', async () => {
      jest.spyOn(axios, 'get').mockResolvedValueOnce({
        data: {
          data: [{ id: 'claude-3-5-haiku-20241022' }, { id: 'claude-3-7-sonnet' }],
        },
      });

      const accounts: CloudAccount[] = [
        {
          id: 'anthropic-1',
          provider: 'anthropic',
          auth_type: 'api_key',
          api_key: 'sk-ant-test',
        } as any,
      ];

      const result = await service.discoverProviderModels(accounts);
      expect(result.has('anthropic_api')).toBe(true);
      const models = result.get('anthropic_api')!;
      expect(models.has('claude-3-5-haiku-20241022')).toBe(true);
      expect(models.has('claude-3-7-sonnet')).toBe(true);
    });

    it('caches discovered models and reuses cache within TTL, supports invalidateCache', async () => {
      const axiosSpy = jest.spyOn(axios, 'get').mockResolvedValue({
        data: { data: [{ id: 'claude-3-7-sonnet' }] },
      });

      const accounts: CloudAccount[] = [
        { id: 'ant-1', provider: 'anthropic', auth_type: 'api_key', api_key: 'sk-ant' } as any,
      ];

      // First call hits network
      await service.discoverProviderModels(accounts);
      expect(axiosSpy).toHaveBeenCalledTimes(1);

      // Second call uses cache
      const cached = await service.discoverProviderModels(accounts);
      expect(cached.get('anthropic_api')?.has('claude-3-7-sonnet')).toBe(true);
      expect(axiosSpy).toHaveBeenCalledTimes(1);

      // Invalidate cache
      service.invalidateCache();
      await service.discoverProviderModels(accounts);
      expect(axiosSpy).toHaveBeenCalledTimes(2);
    });

    it('handles discovery errors for individual accounts gracefully', async () => {
      jest.spyOn(axios, 'get').mockRejectedValueOnce(new Error('Connection timed out'));

      const accounts: CloudAccount[] = [
        { id: 'ant-err', provider: 'anthropic', auth_type: 'api_key', api_key: 'sk-ant' } as any,
      ];

      const result = await service.discoverProviderModels(accounts);
      expect(result.size).toBe(0);
    });
  });

  describe('Anthropic Discovery', () => {
    it('returns fallback models for Anthropic OAuth without API key', async () => {
      const account: CloudAccount = {
        id: 'ant-oauth',
        provider: 'anthropic',
        auth_type: 'oauth',
      } as any;

      const result = await service.discoverProviderModels([account]);
      const models = result.get('anthropic_oauth')!;
      expect(models.has('claude-sonnet-4-6')).toBe(true);
      expect(models.has('claude-3-7-sonnet')).toBe(true);
    });
  });

  describe('OpenAI Discovery', () => {
    it('discovers OpenAI API models using API key', async () => {
      jest.spyOn(axios, 'get').mockResolvedValueOnce({
        data: {
          data: [{ id: 'gpt-4o' }, { id: 'o3-mini' }],
        },
      });

      const account: CloudAccount = {
        id: 'openai-1',
        provider: 'openai',
        auth_type: 'api_key',
        api_key: 'sk-proj-test',
      } as any;

      const result = await service.discoverProviderModels([account]);
      const models = result.get('openai_api')!;
      expect(models.has('gpt-4o')).toBe(true);
      expect(models.has('o3-mini')).toBe(true);
    });

    it('discovers ChatGPT Web/OAuth models using backend API and account ID', async () => {
      jest.spyOn(axios, 'get').mockResolvedValueOnce({
        data: {
          models: [{ slug: 'text-davinci-002-render-sha' }, { slug: 'gpt-4o' }],
        },
      });

      const account: CloudAccount = {
        id: 'chatgpt-1',
        provider: 'openai',
        auth_type: 'oauth',
        account_id: 'org-12345',
        token: { access_token: 'chatgpt-jwt' },
      } as any;

      const result = await service.discoverProviderModels([account]);
      const models = result.get('chatgpt_web')!;
      expect(models.has('gpt-4o')).toBe(true);
      expect(models.has('text-davinci-002-render-sha')).toBe(true);
    });

    it('returns empty models for ChatGPT Web account without access token', async () => {
      const account: CloudAccount = {
        id: 'chatgpt-no-token',
        provider: 'openai',
        auth_type: 'oauth',
      } as any;

      const result = await service.discoverProviderModels([account]);
      expect(result.size).toBe(0);
    });
  });

  describe('Copilot Discovery', () => {
    it('returns fallback models when GitHub token is missing', async () => {
      const account: CloudAccount = {
        id: 'copilot-no-tok',
        provider: 'copilot',
      } as any;

      const result = await service.discoverProviderModels([account]);
      const models = result.get('copilot')!;
      expect(models.has('gpt-4o')).toBe(true);
      expect(models.has('claude-3-7-sonnet')).toBe(true);
    });

    it('queries copilot session token and discovers models via API endpoint', async () => {
      jest.spyOn(axios, 'get')
        .mockResolvedValueOnce({
          data: {
            token: 'copilot-session-token',
            endpoints: { api: 'https://api.githubcopilot.com' },
          },
        })
        .mockResolvedValueOnce({
          data: {
            data: [{ id: 'claude-3.5-sonnet' }, { id: 'gpt-4o' }],
          },
        });

      const account: CloudAccount = {
        id: 'copilot-1',
        provider: 'copilot',
        github_token: 'gho_12345',
      } as any;

      const result = await service.discoverProviderModels([account]);
      const models = result.get('copilot')!;
      expect(models.has('claude-3.5-sonnet')).toBe(true);
      expect(models.has('gpt-4o')).toBe(true);
    });

    it('falls back to standard Copilot models when session exchange fails', async () => {
      jest.spyOn(axios, 'get').mockRejectedValueOnce(new Error('Bad credentials'));

      const account: CloudAccount = {
        id: 'copilot-fail',
        provider: 'copilot',
        github_token: 'gho_revoked',
      } as any;

      const result = await service.discoverProviderModels([account]);
      const models = result.get('copilot')!;
      expect(models.has('gpt-4o')).toBe(true);
    });
  });

  describe('discoverProviderUsage', () => {
    it('returns unavailable for unknown provider', async () => {
      const usage = await service.discoverProviderUsage({ provider: 'unsupported' as any } as any);
      expect(usage.unavailable).toBe('No quota data for this provider');
    });

    it('returns Anthropic plan tier when available', async () => {
      const withOAuth = await service.discoverProviderUsage({
        provider: 'anthropic',
        claude_oauth: { rateLimitTier: 'Scale' },
      } as any);
      expect(withOAuth.plan).toBe('Scale');

      const noTier = await service.discoverProviderUsage({ provider: 'anthropic' } as any);
      expect(noTier.unavailable).toContain('does not expose public quota');
    });

    it('returns OpenAI API plan for API key auth', async () => {
      const usage = await service.discoverProviderUsage({
        provider: 'openai',
        auth_type: 'api_key',
        api_key: 'sk-proj',
      } as any);
      expect(usage.plan).toBe('OpenAI API');
      expect(usage.usages[0].label).toBe('Pay-as-you-go');
    });

    it('returns ChatGPT Web plan and handles missing token or check error', async () => {
      const noToken = await service.discoverProviderUsage({
        provider: 'openai',
        auth_type: 'oauth',
      } as any);
      expect(noToken.unavailable).toContain('No access token');

      // Valid check call
      jest.spyOn(axios, 'get').mockResolvedValueOnce({
        data: {
          accounts: {
            main: {
              account: { plan_display_name: 'ChatGPT Plus' },
            },
          },
        },
      });

      const withToken = await service.discoverProviderUsage({
        provider: 'openai',
        auth_type: 'oauth',
        token: { access_token: 'chatgpt-jwt' },
        account_id: 'chatgpt-org',
      } as any);
      expect(withToken.plan).toBe('ChatGPT Plus');

      // Fallback on network failure
      jest.spyOn(axios, 'get').mockRejectedValueOnce(new Error('500 server error'));
      const withError = await service.discoverProviderUsage({
        provider: 'openai',
        auth_type: 'oauth',
        token: { access_token: 'chatgpt-jwt' },
      } as any);
      expect(withError.plan).toBe('ChatGPT');
    });

    it('returns Copilot usage breakdown with sliding window and daily limits', async () => {
      const noToken = await service.discoverProviderUsage({
        provider: 'copilot',
      } as any);
      expect(noToken.unavailable).toContain('No GitHub token linked');

      jest.spyOn(axios, 'get').mockResolvedValueOnce({
        data: {
          plan: 'Copilot Business',
          sliding_window_limit: {
            limit: 1000,
            usage: { completion_tokens: 200, prompt_tokens: 300 },
            reset_time: '2026-01-01T12:00:00Z',
          },
          daily_usage: {
            completion_tokens: 5000,
            prompt_tokens: 5000,
          },
        },
      });

      const usage = await service.discoverProviderUsage({
        provider: 'copilot',
        github_token: 'gho_123',
      } as any);

      expect(usage.plan).toBe('Copilot Business');
      expect(usage.usages).toHaveLength(2);
      expect(usage.usages[0]).toMatchObject({
        label: 'Sliding Window Usage',
        used: 500,
        limit: 1000,
        percentage: 50,
      });
      expect(usage.usages[1]).toMatchObject({
        label: 'Daily Usage (tokens)',
        used: 10000,
        percentage: 10,
      });
    });

    it('handles Copilot usage error gracefully', async () => {
      jest.spyOn(axios, 'get').mockRejectedValueOnce(new Error('401 Unauthorized'));

      const usage = await service.discoverProviderUsage({
        provider: 'copilot',
        github_token: 'gho_expired',
      } as any);

      expect(usage.unavailable).toContain('Copilot token invalid or expired: 401 Unauthorized');
    });
  });
});
