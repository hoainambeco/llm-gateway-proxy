import { setServerConfig, getServerConfig } from './server-config';
import type { ProxyConfig } from '@/modules/config/types';

describe('server-config', () => {
  it('stores and retrieves server configuration', () => {
    const config: ProxyConfig = {
      port: 9000,
      custom_mapping: { 'claude-v1': 'gemini-3-flash' },
    } as any;

    setServerConfig(config);
    expect(getServerConfig()).toEqual(config);
  });
});
