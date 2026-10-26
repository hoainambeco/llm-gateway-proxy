import {
  googleAccountLeaseUpstreamAdapter,
  cloudAccountStoreAdapter,
} from './account-lease-adapters';
import { GoogleAPIService } from '@/modules/cloud-account/services/GoogleAPIService';
import { CloudAccountRefreshService } from '@/modules/cloud-account/services/CloudAccountRefreshService';
import { jsonAccountStoreInstance } from '../adapters/json-account.store';

jest.mock('@/modules/cloud-account/services/GoogleAPIService', () => ({
  GoogleAPIService: {
    fetchQuota: jest.fn(),
    fetchProjectId: jest.fn(),
    normalizeRefreshedOAuthClientKey: jest.fn(),
  },
}));

jest.mock('@/modules/cloud-account/services/CloudAccountRefreshService', () => ({
  CloudAccountRefreshService: {
    refreshAccessToken: jest.fn(),
  },
}));

describe('account-lease-adapters', () => {
  it('exposes cloudAccountStoreAdapter pointing to jsonAccountStoreInstance', () => {
    expect(cloudAccountStoreAdapter).toBe(jsonAccountStoreInstance);
  });

  describe('googleAccountLeaseUpstreamAdapter', () => {
    it('delegates fetchQuota to GoogleAPIService.fetchQuota', async () => {
      (GoogleAPIService.fetchQuota as jest.Mock).mockResolvedValue({ models: {} });

      const res = await googleAccountLeaseUpstreamAdapter.fetchQuota('token-123', 'http://proxy.local');
      expect(GoogleAPIService.fetchQuota).toHaveBeenCalledWith('token-123', 'http://proxy.local');
      expect(res).toEqual({ models: {} });
    });

    it('delegates refreshAccessToken to CloudAccountRefreshService.refreshAccessToken', async () => {
      (CloudAccountRefreshService.refreshAccessToken as jest.Mock).mockResolvedValue({
        access_token: 'new-token',
      });

      const res = await googleAccountLeaseUpstreamAdapter.refreshAccessToken(
        'acc-1',
        'ref-1',
        'http://proxy.local',
        'client-key',
        {},
      );

      expect(CloudAccountRefreshService.refreshAccessToken).toHaveBeenCalledWith({
        accountId: 'acc-1',
        refreshToken: 'ref-1',
        proxyUrl: 'http://proxy.local',
        oauthClientKey: 'client-key',
        health: {},
      });
      expect(res).toEqual({ access_token: 'new-token' });
    });

    it('delegates fetchProjectId with and without proxyUrl', async () => {
      (GoogleAPIService.fetchProjectId as jest.Mock).mockResolvedValue('my-proj');

      const withProxy = await googleAccountLeaseUpstreamAdapter.fetchProjectId('token', 'http://proxy');
      expect(GoogleAPIService.fetchProjectId).toHaveBeenCalledWith('token', 'http://proxy');
      expect(withProxy).toBe('my-proj');

      const withoutProxy = await googleAccountLeaseUpstreamAdapter.fetchProjectId('token');
      expect(GoogleAPIService.fetchProjectId).toHaveBeenCalledWith('token');
      expect(withoutProxy).toBe('my-proj');
    });

    it('delegates normalizeRefreshedOAuthClientKey to GoogleAPIService', () => {
      (GoogleAPIService.normalizeRefreshedOAuthClientKey as jest.Mock).mockReturnValue('normalized-key');

      const res = googleAccountLeaseUpstreamAdapter.normalizeRefreshedOAuthClientKey(
        { oauth_client_key: 'old' },
        'new',
      );
      expect(GoogleAPIService.normalizeRefreshedOAuthClientKey).toHaveBeenCalledWith(
        { oauth_client_key: 'old' },
        'new',
      );
      expect(res).toBe('normalized-key');
    });
  });
});
