import {
  registerGoogleOAuthState,
  consumeGoogleOAuthState,
} from './google-oauth-state';

describe('google-oauth-state', () => {
  it('registers and consumes a valid OAuth state token once', () => {
    registerGoogleOAuthState('state-token-123');

    // First consumption succeeds
    expect(consumeGoogleOAuthState('state-token-123')).toBe(true);

    // Second consumption fails (single use)
    expect(consumeGoogleOAuthState('state-token-123')).toBe(false);
  });

  it('rejects unregistered or empty states', () => {
    expect(consumeGoogleOAuthState(null)).toBe(false);
    expect(consumeGoogleOAuthState(undefined)).toBe(false);
    expect(consumeGoogleOAuthState('')).toBe(false);
    expect(consumeGoogleOAuthState('never-registered-state')).toBe(false);
  });

  it('rejects expired state tokens past STATE_TTL_MS (10 min)', () => {
    const originalNow = Date.now;
    let currentTime = 1000000;
    Date.now = () => currentTime;

    try {
      registerGoogleOAuthState('ttl-state');

      // Advance 11 minutes (11 * 60 * 1000 = 660,000 ms)
      currentTime += 660001;

      expect(consumeGoogleOAuthState('ttl-state')).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });

  it('prunes expired states upon registering new ones', () => {
    const originalNow = Date.now;
    let currentTime = 1000000;
    Date.now = () => currentTime;

    try {
      registerGoogleOAuthState('old-state');

      currentTime += 660001;

      // Registering a new state triggers pruneExpiredStates
      registerGoogleOAuthState('new-state');

      expect(consumeGoogleOAuthState('old-state')).toBe(false);
      expect(consumeGoogleOAuthState('new-state')).toBe(true);
    } finally {
      Date.now = originalNow;
    }
  });
});
