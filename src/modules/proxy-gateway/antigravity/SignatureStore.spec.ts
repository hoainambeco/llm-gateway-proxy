import { SignatureStore } from './SignatureStore';

describe('SignatureStore', () => {
  beforeEach(() => {
    SignatureStore.clear();
  });

  describe('legacy signature storage (no sessionKey)', () => {
    it('stores and retrieves signature for compatible model', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'sig-abc-123',
      });

      const retrieved = SignatureStore.get({
        model: 'gemini-3-flash',
      });
      expect(retrieved).toBe('sig-abc-123');
    });

    it('returns null if model is incompatible', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'sig-abc-123',
      });

      const retrieved = SignatureStore.get({
        model: 'claude-3-5-sonnet',
      });
      expect(retrieved).toBeNull();
    });

    it('replaces shorter signature with longer signature', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'short',
      });

      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'longer-signature',
      });

      expect(SignatureStore.get({ model: 'gemini-3-flash' })).toBe('longer-signature');
    });

    it('ignores shorter signature when longer exists for same model', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'very-long-signature',
      });

      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'short',
      });

      expect(SignatureStore.get({ model: 'gemini-3-flash' })).toBe('very-long-signature');
    });

    it('takes signature and clears it', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'one-time-sig',
      });

      const taken = SignatureStore.take({ model: 'gemini-3-flash' });
      expect(taken).toBe('one-time-sig');

      expect(SignatureStore.get({ model: 'gemini-3-flash' })).toBeNull();
    });

    it('clears all state when clear() called without argument', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'sig-legacy',
      });
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'sig-session',
        sessionKey: 'session-1',
      });

      SignatureStore.clear();

      expect(SignatureStore.get({ model: 'gemini-3-flash' })).toBeNull();
      expect(SignatureStore.get({ model: 'gemini-3-flash', sessionKey: 'session-1' })).toBeNull();
    });

    it('ignores empty signature or missing model context', () => {
      SignatureStore.store({
        model: '',
        signature: 'some-sig',
      });
      expect(SignatureStore.get({ model: 'gemini-3-flash' })).toBeNull();

      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: '',
      });
      expect(SignatureStore.get({ model: 'gemini-3-flash' })).toBeNull();
    });
  });

  describe('scoped session signature storage (with sessionKey)', () => {
    it('stores and retrieves signature scoped to a session', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'session-1-sig',
        sessionKey: 'sess-abc',
      });

      expect(SignatureStore.get({ model: 'gemini-3-flash', sessionKey: 'sess-abc' })).toBe(
        'session-1-sig',
      );
      expect(SignatureStore.get({ model: 'gemini-3-flash', sessionKey: 'sess-other' })).toBeNull();
      expect(SignatureStore.get({ model: 'gemini-3-flash' })).toBeNull();
    });

    it('stores signatures by messageCount and returns latest messageCount', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'turn-1-sig',
        sessionKey: 'sess-turns',
        messageCount: 1,
      });

      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'turn-3-sig',
        sessionKey: 'sess-turns',
        messageCount: 3,
      });

      expect(SignatureStore.get({ model: 'gemini-3-flash', sessionKey: 'sess-turns' })).toBe(
        'turn-3-sig',
      );
      expect(
        SignatureStore.getAt({
          model: 'gemini-3-flash',
          sessionKey: 'sess-turns',
          messageCount: 1,
        }),
      ).toBe('turn-1-sig');
      expect(
        SignatureStore.getAt({
          model: 'gemini-3-flash',
          sessionKey: 'sess-turns',
          messageCount: 2,
        }),
      ).toBeNull();
    });

    it('prunes future messageCounts on conversation rewind', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'turn-5-sig',
        sessionKey: 'sess-rewind',
        messageCount: 5,
      });

      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'turn-2-sig',
        sessionKey: 'sess-rewind',
        messageCount: 2,
      });

      expect(
        SignatureStore.getAt({
          model: 'gemini-3-flash',
          sessionKey: 'sess-rewind',
          messageCount: 5,
        }),
      ).toBeNull();
      expect(
        SignatureStore.getAt({
          model: 'gemini-3-flash',
          sessionKey: 'sess-rewind',
          messageCount: 2,
        }),
      ).toBe('turn-2-sig');
    });

    it('handles legacySignature within session bucket if messageCount is undefined', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'legacy-session-sig',
        sessionKey: 'sess-legacy-sub',
      });

      expect(
        SignatureStore.get({
          model: 'gemini-3-flash',
          sessionKey: 'sess-legacy-sub',
        }),
      ).toBe('legacy-session-sig');
    });

    it('take() with sessionKey clears session bucket', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'take-session-sig',
        sessionKey: 'sess-take',
      });

      const taken = SignatureStore.take({
        model: 'gemini-3-flash',
        sessionKey: 'sess-take',
      });
      expect(taken).toBe('take-session-sig');
      expect(SignatureStore.get({ model: 'gemini-3-flash', sessionKey: 'sess-take' })).toBeNull();
    });

    it('clears only specific session when clear(sessionKey) is called', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'sig-1',
        sessionKey: 'sess-keep',
      });
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'sig-2',
        sessionKey: 'sess-remove',
      });

      SignatureStore.clear('sess-remove');

      expect(SignatureStore.get({ model: 'gemini-3-flash', sessionKey: 'sess-keep' })).toBe('sig-1');
      expect(SignatureStore.get({ model: 'gemini-3-flash', sessionKey: 'sess-remove' })).toBeNull();
    });

    it('expires sessions after SESSION_TTL_MS', () => {
      const originalNow = Date.now;
      let currentTime = 1000000;
      Date.now = () => currentTime;

      try {
        SignatureStore.store({
          model: 'gemini-3-flash',
          signature: 'ttl-sig',
          sessionKey: 'sess-ttl',
        });

        expect(SignatureStore.get({ model: 'gemini-3-flash', sessionKey: 'sess-ttl' })).toBe(
          'ttl-sig',
        );

        // Advance beyond 1 hour (60 * 60 * 1000 = 3,600,000 ms)
        currentTime += 3600001;

        expect(SignatureStore.get({ model: 'gemini-3-flash', sessionKey: 'sess-ttl' })).toBeNull();
      } finally {
        Date.now = originalNow;
      }
    });

    it('evicts overflow sessions when exceeding MAX_SESSION_ENTRIES (500)', () => {
      for (let i = 0; i <= 505; i++) {
        SignatureStore.store({
          model: 'gemini-3-flash',
          signature: `sig-${i}`,
          sessionKey: `sess-overflow-${i}`,
        });
      }

      // Oldest sessions should have been evicted
      expect(
        SignatureStore.get({ model: 'gemini-3-flash', sessionKey: 'sess-overflow-0' }),
      ).toBeNull();
      // Latest session is still available
      expect(
        SignatureStore.get({ model: 'gemini-3-flash', sessionKey: 'sess-overflow-505' }),
      ).toBe('sig-505');
    });
  });

  describe('toolCallId indexing', () => {
    it('stores and retrieves signature for a specific toolCallId', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'tool-sig-456',
        toolCallId: 'call_123',
        sessionKey: 'sess-tool',
      });

      const retrieved = SignatureStore.getForToolCall({
        model: 'gemini-3-flash',
        toolCallId: 'call_123',
        sessionKey: 'sess-tool',
      });
      expect(retrieved).toBe('tool-sig-456');

      // Non-matching session or toolCallId
      expect(
        SignatureStore.getForToolCall({
          model: 'gemini-3-flash',
          toolCallId: 'call_123',
          sessionKey: 'other-session',
        }),
      ).toBeNull();
      expect(
        SignatureStore.getForToolCall({
          model: 'gemini-3-flash',
          toolCallId: 'wrong_id',
          sessionKey: 'sess-tool',
        }),
      ).toBeNull();
    });

    it('returns null when toolCallId is undefined or empty', () => {
      expect(
        SignatureStore.getForToolCall({
          model: 'gemini-3-flash',
          toolCallId: undefined,
        }),
      ).toBeNull();
    });

    it('replaces shorter tool call signature with longer one', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'short',
        toolCallId: 'call_len',
      });
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'longer-call-signature',
        toolCallId: 'call_len',
      });

      expect(
        SignatureStore.getForToolCall({
          model: 'gemini-3-flash',
          toolCallId: 'call_len',
        }),
      ).toBe('longer-call-signature');
    });

    it('expires tool call entries after SESSION_TTL_MS', () => {
      const originalNow = Date.now;
      let currentTime = 1000000;
      Date.now = () => currentTime;

      try {
        SignatureStore.store({
          model: 'gemini-3-flash',
          signature: 'call-ttl-sig',
          toolCallId: 'call_ttl',
        });

        expect(
          SignatureStore.getForToolCall({
            model: 'gemini-3-flash',
            toolCallId: 'call_ttl',
          }),
        ).toBe('call-ttl-sig');

        currentTime += 3600001;

        expect(
          SignatureStore.getForToolCall({
            model: 'gemini-3-flash',
            toolCallId: 'call_ttl',
          }),
        ).toBeNull();
      } finally {
        Date.now = originalNow;
      }
    });

    it('evicts overflow tool call entries beyond 500', () => {
      for (let i = 0; i <= 505; i++) {
        SignatureStore.store({
          model: 'gemini-3-flash',
          signature: `call-sig-${i}`,
          toolCallId: `call_id_${i}`,
        });
      }

      expect(
        SignatureStore.getForToolCall({
          model: 'gemini-3-flash',
          toolCallId: 'call_id_0',
        }),
      ).toBeNull();
      expect(
        SignatureStore.getForToolCall({
          model: 'gemini-3-flash',
          toolCallId: 'call_id_505',
        }),
      ).toBe('call-sig-505');
    });

    it('clear(sessionKey) clears associated tool call entries', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'tool-sig-to-clear',
        toolCallId: 'call_del',
        sessionKey: 'sess-to-clear',
      });

      SignatureStore.clear('sess-to-clear');

      expect(
        SignatureStore.getForToolCall({
          model: 'gemini-3-flash',
          toolCallId: 'call_del',
          sessionKey: 'sess-to-clear',
        }),
      ).toBeNull();
    });
  });

  describe('clearRecoveryScope', () => {
    it('clears scoped session when sessionKey is provided', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'session-recovery-sig',
        sessionKey: 'recovery-sess',
      });
      SignatureStore.clearRecoveryScope('recovery-sess');

      expect(
        SignatureStore.get({
          model: 'gemini-3-flash',
          sessionKey: 'recovery-sess',
        }),
      ).toBeNull();
    });

    it('clears legacy signature and non-session tool calls when sessionKey is undefined', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'legacy-to-clear',
      });
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'tool-to-clear',
        toolCallId: 'tool-legacy',
      });
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'keep-scoped-tool',
        toolCallId: 'tool-scoped',
        sessionKey: 'scoped-sess',
      });

      SignatureStore.clearRecoveryScope();

      expect(SignatureStore.get({ model: 'gemini-3-flash' })).toBeNull();
      expect(
        SignatureStore.getForToolCall({
          model: 'gemini-3-flash',
          toolCallId: 'tool-legacy',
        }),
      ).toBeNull();
      expect(
        SignatureStore.getForToolCall({
          model: 'gemini-3-flash',
          toolCallId: 'tool-scoped',
          sessionKey: 'scoped-sess',
        }),
      ).toBe('keep-scoped-tool');
    });
  });

  describe('additional edge cases', () => {
    it('skips shorter signature in scoped session', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'long-session-sig',
        sessionKey: 'sess-skip',
        messageCount: 1,
      });
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'short',
        sessionKey: 'sess-skip',
        messageCount: 1,
      });

      expect(
        SignatureStore.getAt({
          model: 'gemini-3-flash',
          sessionKey: 'sess-skip',
          messageCount: 1,
        }),
      ).toBe('long-session-sig');
    });

    it('skips shorter signature in toolCallId storage', () => {
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'tool-long-sig',
        toolCallId: 'call-skip',
      });
      SignatureStore.store({
        model: 'gemini-3-flash',
        signature: 'shorter',
        toolCallId: 'call-skip',
      });

      expect(
        SignatureStore.getForToolCall({
          model: 'gemini-3-flash',
          toolCallId: 'call-skip',
        }),
      ).toBe('tool-long-sig');
    });

    it('handles invalid model or missing session in get(), getForToolCall(), getAt()', () => {
      expect(SignatureStore.get({ model: '' })).toBeNull();
      expect(SignatureStore.getForToolCall({ model: '', toolCallId: 'abc' })).toBeNull();
      expect(
        SignatureStore.getAt({
          model: 'gemini-3-flash',
          sessionKey: undefined,
          messageCount: 1,
        }),
      ).toBeNull();
      expect(
        SignatureStore.getAt({
          model: '',
          sessionKey: 'sess-x',
          messageCount: 1,
        }),
      ).toBeNull();
      expect(
        SignatureStore.getAt({
          model: 'gemini-3-flash',
          sessionKey: 'non-existent',
          messageCount: 1,
        }),
      ).toBeNull();
    });

    it('handles expired session in getAt()', () => {
      const originalNow = Date.now;
      let currentTime = 1000000;
      Date.now = () => currentTime;

      try {
        SignatureStore.store({
          model: 'gemini-3-flash',
          signature: 'turn-sig',
          sessionKey: 'sess-getat-ttl',
          messageCount: 1,
        });

        expect(
          SignatureStore.getAt({
            model: 'gemini-3-flash',
            sessionKey: 'sess-getat-ttl',
            messageCount: 1,
          }),
        ).toBe('turn-sig');

        currentTime += 3600001;

        expect(
          SignatureStore.getAt({
            model: 'gemini-3-flash',
            sessionKey: 'sess-getat-ttl',
            messageCount: 1,
          }),
        ).toBeNull();
      } finally {
        Date.now = originalNow;
      }
    });

    it('actively evicts expired sessions and tool calls on new store operations', () => {
      const originalNow = Date.now;
      let currentTime = 1000000;
      Date.now = () => currentTime;

      try {
        SignatureStore.store({
          model: 'gemini-3-flash',
          signature: 'old-sess',
          sessionKey: 'sess-old',
          toolCallId: 'call-old',
        });

        currentTime += 3600001;

        // Next store triggers evictExpiredSessions and evictExpiredToolCallEntries
        SignatureStore.store({
          model: 'gemini-3-flash',
          signature: 'new-sess',
          sessionKey: 'sess-new',
          toolCallId: 'call-new',
        });

        expect(SignatureStore.get({ model: 'gemini-3-flash', sessionKey: 'sess-old' })).toBeNull();
        expect(
          SignatureStore.getForToolCall({ model: 'gemini-3-flash', toolCallId: 'call-old' }),
        ).toBeNull();
      } finally {
        Date.now = originalNow;
      }
    });
  });
});
