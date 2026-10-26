import { AccountLeaseConfigPolicy } from './account-lease-config.policy';
import { setServerConfig } from '../../../../../../server/server-config';
import type { ProxyConfig } from '@/modules/config/types';

describe('AccountLeaseConfigPolicy', () => {
  let policy: AccountLeaseConfigPolicy;
  const originalEnv = process.env.PROXY_FALLBACK_PROJECT_ID;

  beforeEach(() => {
    policy = new AccountLeaseConfigPolicy();
    setServerConfig(null as unknown as ProxyConfig);
    delete process.env.PROXY_FALLBACK_PROJECT_ID;
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.PROXY_FALLBACK_PROJECT_ID = originalEnv;
    } else {
      delete process.env.PROXY_FALLBACK_PROJECT_ID;
    }
  });

  describe('getSelectionConfig', () => {
    it('returns default values when serverConfig is null', () => {
      const config = policy.getSelectionConfig();
      expect(config).toEqual({
        quotaAwareSchedulingEnabled: true,
        parityEnabled: false,
        parityShadowEnabled: false,
        schedulingMode: 'balance',
        preferredAccountId: undefined,
        maxWaitMs: 60000,
        noGoMismatchRateThreshold: 0.15,
        noGoErrorRateThreshold: 0.4,
      });
    });

    it('reads configured values and respects parity kill switch', () => {
      setServerConfig({
        quota_aware_scheduling_enabled: false,
        parity_enabled: true,
        parity_kill_switch: true,
        parity_shadow_enabled: true,
        scheduling_mode: 'cache-first',
        preferred_account_id: 'acc-preferred',
        max_wait_seconds: 120,
        parity_no_go_mismatch_rate: 0.25,
        parity_no_go_error_rate: 0.5,
      } as unknown as ProxyConfig);

      const config = policy.getSelectionConfig();
      expect(config.quotaAwareSchedulingEnabled).toBe(false);
      expect(config.parityEnabled).toBe(false); // kill switch is active
      expect(config.parityShadowEnabled).toBe(true);
      expect(config.schedulingMode).toBe('cache-first');
      expect(config.preferredAccountId).toBe('acc-preferred');
      expect(config.maxWaitMs).toBe(120000);
      expect(config.noGoMismatchRateThreshold).toBe(0.25);
      expect(config.noGoErrorRateThreshold).toBe(0.5);
    });

    it('handles parity_enabled true without kill switch', () => {
      setServerConfig({
        parity_enabled: true,
        parity_kill_switch: false,
        scheduling_mode: 'performance-first',
      } as unknown as ProxyConfig);

      const config = policy.getSelectionConfig();
      expect(config.parityEnabled).toBe(true);
      expect(config.schedulingMode).toBe('performance-first');
    });

    it('falls back to balance mode for invalid scheduling_mode', () => {
      setServerConfig({
        scheduling_mode: 'random-unsupported',
      } as unknown as ProxyConfig);

      expect(policy.getSelectionConfig().schedulingMode).toBe('balance');
    });

    it('clamps negative max_wait_seconds to 0 ms', () => {
      setServerConfig({
        max_wait_seconds: -10,
      } as unknown as ProxyConfig);

      expect(policy.getSelectionConfig().maxWaitMs).toBe(0);
    });

    it('trims whitespace and treats empty preferred_account_id as undefined', () => {
      setServerConfig({
        preferred_account_id: '   ',
      } as unknown as ProxyConfig);

      expect(policy.getSelectionConfig().preferredAccountId).toBeUndefined();
    });

    it('clamps and falls back thresholds on non-finite values', () => {
      setServerConfig({
        parity_no_go_mismatch_rate: NaN,
        parity_no_go_error_rate: Infinity,
      } as unknown as ProxyConfig);

      const config = policy.getSelectionConfig();
      expect(config.noGoMismatchRateThreshold).toBe(0.15);
      expect(config.noGoErrorRateThreshold).toBe(0.4);

      setServerConfig({
        parity_no_go_mismatch_rate: 1.5, // should clamp to 1
        parity_no_go_error_rate: -0.2, // should clamp to 0
      } as unknown as ProxyConfig);

      const clamped = policy.getSelectionConfig();
      expect(clamped.noGoMismatchRateThreshold).toBe(1);
      expect(clamped.noGoErrorRateThreshold).toBe(0);
    });
  });

  describe('setPreferredAccount', () => {
    it('does nothing when serverConfig is null', () => {
      expect(() => policy.setPreferredAccount('acc-1')).not.toThrow();
    });

    it('sets preferred account on existing serverConfig', () => {
      const cfg = { preferred_account_id: '' } as unknown as ProxyConfig;
      setServerConfig(cfg);

      policy.setPreferredAccount('new-acc');
      expect(cfg.preferred_account_id).toBe('new-acc');

      policy.setPreferredAccount(undefined);
      expect(cfg.preferred_account_id).toBe('');
    });
  });

  describe('getCircuitBreakerBackoffSteps', () => {
    it('returns default backoff steps when serverConfig is null', () => {
      expect(policy.getCircuitBreakerBackoffSteps()).toEqual([60, 300, 1800, 7200]);
    });

    it('normalizes valid positive steps with ceiling', () => {
      setServerConfig({
        circuit_breaker_backoff_steps: [10.2, 50, '120.8', -5, 0, NaN],
      } as unknown as ProxyConfig);

      expect(policy.getCircuitBreakerBackoffSteps()).toEqual([11, 50, 121]);
    });

    it('returns default steps when configured array has no positive finite numbers', () => {
      setServerConfig({
        circuit_breaker_backoff_steps: [-10, 0, NaN, 'not-a-number'],
      } as unknown as ProxyConfig);

      expect(policy.getCircuitBreakerBackoffSteps()).toEqual([60, 300, 1800, 7200]);
    });
  });

  describe('resolveFallbackProjectId', () => {
    it('returns default fallback project id when env var is unset', () => {
      expect(policy.resolveFallbackProjectId()).toBe('silver-orbit-5m7qc');
    });

    it('returns normalized project id from env var when valid', () => {
      process.env.PROXY_FALLBACK_PROJECT_ID = '  my-custom-project  ';
      expect(policy.resolveFallbackProjectId()).toBe('my-custom-project');
    });

    it('falls back to default if env var is cloud-code template or projects/ prefix', () => {
      process.env.PROXY_FALLBACK_PROJECT_ID = 'cloud-code-12345';
      expect(policy.resolveFallbackProjectId()).toBe('silver-orbit-5m7qc');

      process.env.PROXY_FALLBACK_PROJECT_ID = 'projects/something';
      expect(policy.resolveFallbackProjectId()).toBe('silver-orbit-5m7qc');
    });
  });
});
