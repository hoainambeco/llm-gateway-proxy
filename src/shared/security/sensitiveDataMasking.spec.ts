import { sanitizeObject, safeStringifyPacket } from './sensitiveDataMasking';

describe('sanitizeObject', () => {
  it('redacts nested sensitive keys and keeps ordinary fields untouched', () => {
    const input = {
      user: 'alice',
      age: 30,
      session: {
        password: 'hunter2',
        authorization: 'Bearer sk-live-abc123',
        access_token: 'topsecrettoken',
        role: 'admin',
        profile: {
          email: 'alice@example.com',
          'x-goog-api-key': 'AIzaSyD-DEADBEEF0123456789abcdefghijk',
        },
      },
    };

    const sanitized = sanitizeObject(input) as typeof input;

    // Ordinary fields remain untouched.
    expect(sanitized.user).toBe('alice');
    expect(sanitized.age).toBe(30);
    expect(sanitized.session.role).toBe('admin');
    expect(sanitized.session.profile.email).toBe('alice@example.com');

    // Sensitive values, at any depth, are redacted.
    expect(sanitized.session.password).not.toBe('hunter2');
    expect(sanitized.session.password).not.toContain('hunter2');
    expect(sanitized.session.authorization).not.toBe('Bearer sk-live-abc123');
    expect(String(sanitized.session.authorization)).not.toContain('sk-live-abc123');
    expect(sanitized.session.access_token).not.toBe('topsecrettoken');
    expect(sanitized.session.access_token).not.toContain('topsecrettoken');
    expect(sanitized.session.profile['x-goog-api-key']).not.toContain('AIza');
  });

  it('is not case sensitive about sensitive keys', () => {
    const sanitized = sanitizeObject({ PassWord: 'leak', AUTHORIZATION: 'leak' }) as Record<
      string,
      unknown
    >;

    expect(sanitized.PassWord).not.toBe('leak');
    expect(sanitized.AUTHORIZATION).not.toBe('leak');
  });

  it('preserves array length and kept values inside arrays', () => {
    const input = {
      tags: ['alpha', 'beta', 'gamma'],
      records: [
        { id: 1, password: 'secret-a' },
        { id: 2, password: 'secret-b' },
        { id: 3, password: 'secret-c' },
      ],
    };

    const sanitized = sanitizeObject(input) as typeof input;

    expect(sanitized.tags).toHaveLength(3);
    expect(sanitized.tags).toEqual(['alpha', 'beta', 'gamma']);
    expect(sanitized.records).toHaveLength(3);
    expect(sanitized.records.map((r) => r.id)).toEqual([1, 2, 3]);
    for (const record of sanitized.records) {
      expect(record.password).not.toContain('secret-');
    }
  });

  it('does not mutate the input object', () => {
    const input = { keep: true, password: 'unchanged-original' };
    sanitizeObject(input);
    expect(input.password).toBe('unchanged-original');
    expect(input.keep).toBe(true);
  });

  it('handles primitives and null/undefined without throwing', () => {
    expect(sanitizeObject(null)).toBeNull();
    expect(sanitizeObject(undefined)).toBeUndefined();
    expect(sanitizeObject(42)).toBe(42);
    expect(sanitizeObject('plain text')).toBe('plain text');
  });

  it('replaces circular references instead of throwing', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;

    expect(() => sanitizeObject(node)).not.toThrow();
    expect(JSON.stringify(sanitizeObject(node))).toContain('[Circular]');
  });

  it('redacts credentials embedded inside nested JSON strings', () => {
    const input = { body: JSON.stringify({ password: 'inner-secret', note: 'safe' }) };
    const sanitized = sanitizeObject(input) as { body: string };

    expect(sanitized.body).not.toContain('inner-secret');
    expect(JSON.parse(sanitized.body)).toEqual({ password: '[REDACTED]', note: 'safe' });
  });
});

describe('safeStringifyPacket', () => {
  it('stringifies a sanitized packet without leaking sensitive values', () => {
    const packet = safeStringifyPacket({
      id: 'p-1',
      headers: { authorization: 'Bearer supersecretvalue', accept: 'application/json' },
    });

    expect(packet).not.toContain('supersecretvalue');
    const parsed = JSON.parse(packet) as { id: string; headers: Record<string, unknown> };
    expect(parsed.id).toBe('p-1');
    expect(parsed.headers.accept).toBe('application/json');
    expect(parsed.headers.authorization).not.toBe('Bearer supersecretvalue');
  });

  it('never throws on circular structures', () => {
    const packet: Record<string, unknown> = { trace: 'circular' };
    packet.loop = packet;

    expect(() => safeStringifyPacket(packet)).not.toThrow();
    expect(safeStringifyPacket(packet)).toContain('[Circular]');
  });
});
