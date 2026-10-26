import {
  OAuthClientRegistryService,
  normalizeOAuthClientKey,
  MISSING_OAUTH_CLIENT_MESSAGE,
} from './OAuthClientRegistryService';

describe('OAuthClientRegistryService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ANTIGRAVITY_OAUTH_CLIENT_ID;
    delete process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET;
    delete process.env.ANTIGRAVITY_OAUTH_CLIENTS;
    delete process.env.ANTIGRAVITY_OAUTH_CLIENT_KEY;
    OAuthClientRegistryService.resetStateForTesting();
  });

  afterEach(() => {
    process.env = originalEnv;
    OAuthClientRegistryService.resetStateForTesting();
  });

  describe('normalizeOAuthClientKey', () => {
    it('trims and lowercases the key', () => {
      expect(normalizeOAuthClientKey('  Google_Cloud_123  ')).toBe('google_cloud_123');
    });
  });

  describe('Registry Initialization from Environment', () => {
    it('warns when no clients are configured and throws on selectAuthClient', () => {
      expect(OAuthClientRegistryService.listOAuthClients()).toEqual([]);
      expect(() => OAuthClientRegistryService.selectAuthClient()).toThrow(
        MISSING_OAUTH_CLIENT_MESSAGE,
      );
    });

    it('warns and ignores incomplete builtin credentials when only one is set', () => {
      process.env.ANTIGRAVITY_OAUTH_CLIENT_ID = 'client-id-only';
      OAuthClientRegistryService.resetStateForTesting();

      expect(OAuthClientRegistryService.listOAuthClients()).toEqual([]);
    });

    it('creates builtin client when both client ID and client secret are provided', () => {
      process.env.ANTIGRAVITY_OAUTH_CLIENT_ID = 'builtin-id';
      process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = 'builtin-secret';
      OAuthClientRegistryService.resetStateForTesting();

      const clients = OAuthClientRegistryService.listOAuthClients();
      expect(clients).toHaveLength(1);
      expect(clients[0]).toMatchObject({
        key: 'antigravity_enterprise',
        label: 'Antigravity Enterprise',
        client_id: 'builtin-id',
        is_active: true,
        is_builtin: true,
      });
    });

    it('parses multiple extra clients from ANTIGRAVITY_OAUTH_CLIENTS', () => {
      process.env.ANTIGRAVITY_OAUTH_CLIENTS =
        'client_a|id_a|secret_a|Client Alpha;client_b|id_b|secret_b;   ;invalid_too_few_parts;key_c||secret_c';
      OAuthClientRegistryService.resetStateForTesting();

      const clients = OAuthClientRegistryService.listOAuthClients();
      expect(clients).toHaveLength(2);
      expect(clients[0]).toMatchObject({
        key: 'client_a',
        label: 'Client Alpha',
        client_id: 'id_a',
        is_active: true,
        is_builtin: false,
      });
      expect(clients[1]).toMatchObject({
        key: 'client_b',
        label: 'client_b', // defaults to key when label omitted
        client_id: 'id_b',
      });
    });

    it('overwrites builtin client config if the same key appears in extra clients', () => {
      process.env.ANTIGRAVITY_OAUTH_CLIENT_ID = 'builtin-id';
      process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = 'builtin-secret';
      process.env.ANTIGRAVITY_OAUTH_CLIENTS =
        'antigravity_enterprise|custom-override-id|custom-override-secret|Overridden Enterprise';
      OAuthClientRegistryService.resetStateForTesting();

      const clients = OAuthClientRegistryService.listOAuthClients();
      expect(clients).toHaveLength(1);
      expect(clients[0]).toMatchObject({
        key: 'antigravity_enterprise',
        label: 'Overridden Enterprise',
        client_id: 'custom-override-id',
        is_builtin: true,
      });
    });
  });

  describe('Active Client Selection & Management', () => {
    beforeEach(() => {
      process.env.ANTIGRAVITY_OAUTH_CLIENTS =
        'client1|id1|secret1|Client One;client2|id2|secret2|Client Two';
      OAuthClientRegistryService.resetStateForTesting();
    });

    it('defaults active client to ANTIGRAVITY_OAUTH_CLIENT_KEY when valid', () => {
      process.env.ANTIGRAVITY_OAUTH_CLIENT_KEY = 'client2';
      OAuthClientRegistryService.resetStateForTesting();

      expect(OAuthClientRegistryService.getActiveOAuthClientKey()).toBe('client2');
    });

    it('falls back to first client if configured active key is unknown', () => {
      process.env.ANTIGRAVITY_OAUTH_CLIENT_KEY = 'unknown_client';
      OAuthClientRegistryService.resetStateForTesting();

      expect(OAuthClientRegistryService.getActiveOAuthClientKey()).toBe('client1');
    });

    it('changes active client dynamically via setActiveOAuthClientKey', () => {
      OAuthClientRegistryService.setActiveOAuthClientKey('CLIENT2');
      expect(OAuthClientRegistryService.getActiveOAuthClientKey()).toBe('client2');
      expect(process.env.ANTIGRAVITY_OAUTH_CLIENT_KEY).toBe('client2');

      const clients = OAuthClientRegistryService.listOAuthClients();
      expect(clients.find((c) => c.key === 'client2')?.is_active).toBe(true);
      expect(clients.find((c) => c.key === 'client1')?.is_active).toBe(false);
    });

    it('throws when setting an unknown active client key', () => {
      expect(() =>
        OAuthClientRegistryService.setActiveOAuthClientKey('non_existent'),
      ).toThrow(/Unknown OAuth client key 'non_existent'/);
    });
  });

  describe('selectAuthClient & getCandidateClients', () => {
    beforeEach(() => {
      process.env.ANTIGRAVITY_OAUTH_CLIENTS =
        'c1|id1|sec1|Client 1;c2|id2|sec2|Client 2;c3|id3|sec3|Client 3';
      process.env.ANTIGRAVITY_OAUTH_CLIENT_KEY = 'c2';
      OAuthClientRegistryService.resetStateForTesting();
    });

    it('selectAuthClient selects preferred client by key or active key', () => {
      const selectedPreferred = OAuthClientRegistryService.selectAuthClient('c3');
      expect(selectedPreferred.key).toBe('c3');

      const selectedDefault = OAuthClientRegistryService.selectAuthClient();
      expect(selectedDefault.key).toBe('c2'); // active key
    });

    it('selectAuthClient throws on unknown client key', () => {
      expect(() => OAuthClientRegistryService.selectAuthClient('unknown_key')).toThrow(
        'Unknown OAuth client key: unknown_key',
      );
    });

    it('getCandidateClients returns deduped list starting with preferred then active then remainder', () => {
      const candidates = OAuthClientRegistryService.getCandidateClients('c3');
      const candidateKeys = candidates.map((c) => c.key);

      expect(candidateKeys).toEqual(['c3', 'c2', 'c1']);
    });

    it('getCandidateClients falls back to active client list when preferred client not found', () => {
      const candidates = OAuthClientRegistryService.getCandidateClients('unknown');
      const candidateKeys = candidates.map((c) => c.key);

      expect(candidateKeys).toEqual(['c2', 'c1', 'c3']);
    });
  });

  describe('normalizeRefreshedOAuthClientKey', () => {
    it('returns undefined for legacy account without project_id refreshing via enterprise client', () => {
      const normalized = OAuthClientRegistryService.normalizeRefreshedOAuthClientKey(
        { oauth_client_key: undefined, project_id: undefined },
        'antigravity_enterprise',
      );
      expect(normalized).toBeUndefined();

      const normalizedEmpty = OAuthClientRegistryService.normalizeRefreshedOAuthClientKey(
        { oauth_client_key: undefined, project_id: '   ' },
        'ANTIGRAVITY_ENTERPRISE',
      );
      expect(normalizedEmpty).toBeUndefined();
    });

    it('preserves client key when project_id is present', () => {
      const normalized = OAuthClientRegistryService.normalizeRefreshedOAuthClientKey(
        { oauth_client_key: undefined, project_id: 'my-gcp-project' },
        'antigravity_enterprise',
      );
      expect(normalized).toBe('antigravity_enterprise');
    });

    it('normalizes custom client keys or preserves currentToken oauth_client_key', () => {
      const normalizedCustom = OAuthClientRegistryService.normalizeRefreshedOAuthClientKey(
        { oauth_client_key: 'old_key' },
        'NEW_CUSTOM_KEY',
      );
      expect(normalizedCustom).toBe('new_custom_key');

      const normalizedCurrent = OAuthClientRegistryService.normalizeRefreshedOAuthClientKey(
        { oauth_client_key: 'OLD_KEY' },
        undefined,
      );
      expect(normalizedCurrent).toBe('old_key');

      const undefinedResult = OAuthClientRegistryService.normalizeRefreshedOAuthClientKey(
        { oauth_client_key: undefined },
        undefined,
      );
      expect(undefinedResult).toBeUndefined();
    });
  });
});
