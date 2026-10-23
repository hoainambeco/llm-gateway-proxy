import {
  hasErrorCode,
  isErrorWithCode,
  isErrorWithHttpStatus,
} from './error-guards';

describe('isErrorWithCode', () => {
  it('narrows a real Error carrying a string code', () => {
    const error = new Error('boom') as Error & { code: string };
    error.code = 'ECONNREFUSED';

    expect(isErrorWithCode(error)).toBe(true);
  });

  it('narrows subclasses of Error with a code', () => {
    class CodedError extends Error {
      constructor(
        message: string,
        readonly code: string,
      ) {
        super(message);
      }
    }

    expect(isErrorWithCode(new CodedError('boom', 'EACCES'))).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'ECONNREFUSED'],
    ['a number', 42],
  ])('rejects %s without throwing', (_label, value) => {
    expect(() => isErrorWithCode(value)).not.toThrow();
    expect(isErrorWithCode(value)).toBe(false);
  });

  it.each([
    ['a plain object', { code: 'ECONNREFUSED' } as unknown],
    ['a plain object with numeric code', { code: 42 } as unknown],
    ['an array', ['ECONNREFUSED']],
    ['a function code on a plain object', { code: () => {} } as unknown],
  ])('rejects %s even when it carries a code field', (_label, value) => {
    expect(isErrorWithCode(value)).toBe(false);
  });

  it('rejects a real Error without a code', () => {
    expect(isErrorWithCode(new Error('no code here'))).toBe(false);
  });

  it('rejects a real Error whose code is not a string', () => {
    const error = new Error('numeric code') as Error & { code: number };
    error.code = 42;

    expect(isErrorWithCode(error)).toBe(false);
  });
});

describe('hasErrorCode', () => {
  it('matches the exact expected code and narrows the type', () => {
    const error = new Error('precondition failed') as Error & { code: 'ENOENT' };
    error.code = 'ENOENT';

    expect(hasErrorCode(error, 'ENOENT')).toBe(true);
  });

  it('returns false for a different code', () => {
    const error = new Error('mismatch') as Error & { code: string };
    error.code = 'EACCES';

    expect(hasErrorCode(error, 'ENOENT')).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a plain object impersonating the code', { code: 'ENOENT' } as unknown],
  ])('rejects %s without throwing', (_label, value) => {
    expect(() => hasErrorCode(value, 'ENOENT')).not.toThrow();
    expect(hasErrorCode(value, 'ENOENT')).toBe(false);
  });
});

describe('isErrorWithHttpStatus', () => {
  it('narrows a real Error carrying a numeric httpStatus', () => {
    const error = new Error('upstream refused') as Error & { httpStatus: number };
    error.httpStatus = 502;

    expect(isErrorWithHttpStatus(error)).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a plain object with an httpStatus field', { httpStatus: 502 } as unknown],
    ['a plain object with a string status', { httpStatus: '502' } as unknown],
  ])('rejects %s without throwing', (_label, value) => {
    expect(() => isErrorWithHttpStatus(value)).not.toThrow();
    expect(isErrorWithHttpStatus(value)).toBe(false);
  });

  it('rejects a real Error without an httpStatus', () => {
    expect(isErrorWithHttpStatus(new Error('no status'))).toBe(false);
  });

  it('rejects a real Error whose httpStatus is not numeric', () => {
    const error = new Error('string status') as Error & { httpStatus: string };
    error.httpStatus = '502';

    expect(isErrorWithHttpStatus(error)).toBe(false);
  });
});
