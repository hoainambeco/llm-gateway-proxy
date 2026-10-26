import {
  AppError,
  getAppErrorData,
  shouldReportErrorToSentry,
} from './appError';

describe('AppError', () => {
  it('keeps code, message and every option the caller passed', () => {
    const metadata = { accountId: 'acc-1', email: 'user@example.com' };
    const error = new AppError('CLOUD_ACCOUNT_LOGIN_EXPIRED', 'Session expired', {
      messageKey: 'APP_CLOUD_ACCOUNT_LOGIN_EXPIRED',
      detailMessageKey: 'APP_DETAIL_RELOGIN_REQUIRED',
      reportToSentry: false,
      transportCode: 'UNAUTHORIZED',
      metadata,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.code).toBe('CLOUD_ACCOUNT_LOGIN_EXPIRED');
    expect(error.message).toBe('Session expired');
    expect(error.messageKey).toBe('APP_CLOUD_ACCOUNT_LOGIN_EXPIRED');
    expect(error.detailMessageKey).toBe('APP_DETAIL_RELOGIN_REQUIRED');
    expect(error.reportToSentry).toBe(false);
    expect(error.transportCode).toBe('UNAUTHORIZED');
    expect(error.metadata).toEqual({ accountId: 'acc-1', email: 'user@example.com' });
  });

  it('applies documented defaults for reportToSentry and transportCode', () => {
    const error = new AppError('KEYCHAIN_UNAVAILABLE', 'Keychain locked', {
      messageKey: 'APP_KEYCHAIN_UNAVAILABLE',
      metadata: { hint: null },
    });

    expect(error.reportToSentry).toBe(true);
    expect(error.transportCode).toBe('INTERNAL_SERVER_ERROR');
  });

  it('recovers its cause chain via Error cause', () => {
    const cause = new Error('root cause');
    const error = new AppError('DATA_MIGRATION_FAILED', 'Migration crashed', {
      messageKey: 'APP_DATA_MIGRATION_FAILED',
      metadata: { hint: 'HINT_RELOGIN' },
      cause,
    });

    expect(error.cause).toBe(cause);
  });
});

describe('getAppErrorData', () => {
  it('round-trips an AppError, preserving code, message keys, metadata and reportToSentry', () => {
    const error = new AppError('MASTER_KEY_UNAVAILABLE', 'No recovery key matched', {
      messageKey: 'APP_MASTER_KEY_UNAVAILABLE',
      detailMessageKey: 'APP_DETAIL_RECOVERY_REQUIRED',
      reportToSentry: false,
      metadata: {
        hint: 'HINT_RECOVERY',
        reason: 'NO_MATCHING_KEY',
        storedAccountCount: 3,
      },
    });

    expect(getAppErrorData(error)).toEqual({
      appErrorCode: 'MASTER_KEY_UNAVAILABLE',
      messageKey: 'APP_MASTER_KEY_UNAVAILABLE',
      detailMessageKey: 'APP_DETAIL_RECOVERY_REQUIRED',
      reportToSentry: false,
      metadata: {
        hint: 'HINT_RECOVERY',
        reason: 'NO_MATCHING_KEY',
        storedAccountCount: 3,
      },
    });
  });

  it('reads a serialized AppError payload from a plain object', () => {
    const payload = {
      appErrorCode: 'CLOUD_ACCOUNT_LOGIN_EXPIRED',
      messageKey: 'APP_CLOUD_ACCOUNT_LOGIN_EXPIRED',
      reportToSentry: true,
      metadata: { accountId: 'acc-9', email: 'a@b.co' },
    };

    expect(getAppErrorData(payload)).toEqual(payload);
  });

  it('reads a serialized AppError payload wrapped in a `data` envelope', () => {
    const payload = {
      appErrorCode: 'DATA_MIGRATION_FAILED',
      messageKey: 'APP_DATA_MIGRATION_FAILED',
      metadata: { hint: 'HINT_CLEAR_DATA' },
    };

    expect(getAppErrorData({ data: payload })).toMatchObject(payload);
  });

  it('defaults reportToSentry to true when a payload omits it', () => {
    const data = getAppErrorData({
      appErrorCode: 'KEYCHAIN_UNAVAILABLE',
      messageKey: 'APP_KEYCHAIN_UNAVAILABLE',
    });

    expect(data?.reportToSentry).toBe(true);
  });

  it.each([
    ['a plain unrelated object', { foo: 'bar' }],
    ['a plain object with an unknown appErrorCode', { appErrorCode: 'NOT_A_CODE', messageKey: 'K' }],
    ['a plain object with a non-string messageKey', { appErrorCode: 'KEYCHAIN_UNAVAILABLE', messageKey: 42 }],
    ['a plain object with no appErrorCode at all', { messageKey: 'K' }],
    ['null', null],
    ['undefined', undefined],
    ['an ordinary string', 'boom'],
  ])('returns undefined for %s without throwing', (label, value) => {
    expect(getAppErrorData(value)).toBeUndefined();
  });

  it('returns undefined for an ordinary Error that is no AppError', () => {
    expect(getAppErrorData(new Error('stock error'))).toBeUndefined();
  });

  it('normalizes a payload with unknown metadata shape to no metadata', () => {
    const data = getAppErrorData({
      appErrorCode: 'CLOUD_ACCOUNT_LOGIN_EXPIRED',
      messageKey: 'APP_CLOUD_ACCOUNT_LOGIN_EXPIRED',
      metadata: { accountId: 1, unrelated: true },
    });

    expect(data?.metadata).toBeUndefined();
  });

  describe('metadata normalization for specific error codes', () => {
    it.each([
      ['HINT_APP_TRANSLOCATION', { hint: 'HINT_APP_TRANSLOCATION' }],
      ['HINT_KEYCHAIN_DENIED', { hint: 'HINT_KEYCHAIN_DENIED' }],
      ['HINT_SIGN_NOTARIZE', { hint: 'HINT_SIGN_NOTARIZE' }],
      ['null', { hint: null }],
    ])('validates KEYCHAIN_UNAVAILABLE metadata with hint %s', (_, metadata) => {
      const data = getAppErrorData({
        appErrorCode: 'KEYCHAIN_UNAVAILABLE',
        messageKey: 'APP_KEYCHAIN_UNAVAILABLE',
        metadata,
      });
      expect(data?.metadata).toEqual(metadata);
    });

    it('returns undefined metadata for KEYCHAIN_UNAVAILABLE with invalid hint', () => {
      const data = getAppErrorData({
        appErrorCode: 'KEYCHAIN_UNAVAILABLE',
        messageKey: 'APP_KEYCHAIN_UNAVAILABLE',
        metadata: { hint: 'INVALID_HINT' },
      });
      expect(data?.metadata).toBeUndefined();
    });

    it.each([
      ['HINT_APP_TRANSLOCATION', 'NO_MATCHING_KEY'],
      ['HINT_KEYCHAIN_DENIED', 'PROVIDER_UNAVAILABLE'],
      ['HINT_MANUAL_SIGN', 'NOT_INITIALIZED'],
      ['HINT_RECOVERY', 'NO_MATCHING_KEY'],
      [null, 'PROVIDER_UNAVAILABLE'],
    ])('validates MASTER_KEY_UNAVAILABLE metadata with hint %s and reason %s', (hint, reason) => {
      const metadata = { hint, reason, storedAccountCount: 2 };
      const data = getAppErrorData({
        appErrorCode: 'MASTER_KEY_UNAVAILABLE',
        messageKey: 'APP_MASTER_KEY_UNAVAILABLE',
        metadata,
      });
      expect(data?.metadata).toEqual(metadata);
    });

    it('returns undefined metadata for MASTER_KEY_UNAVAILABLE when reason or count is invalid', () => {
      expect(
        getAppErrorData({
          appErrorCode: 'MASTER_KEY_UNAVAILABLE',
          messageKey: 'APP_MASTER_KEY_UNAVAILABLE',
          metadata: { hint: 'HINT_RECOVERY', reason: 'BAD_REASON', storedAccountCount: 1 },
        })?.metadata,
      ).toBeUndefined();

      expect(
        getAppErrorData({
          appErrorCode: 'MASTER_KEY_UNAVAILABLE',
          messageKey: 'APP_MASTER_KEY_UNAVAILABLE',
          metadata: { hint: 'HINT_RECOVERY', reason: 'NO_MATCHING_KEY', storedAccountCount: 'not-a-number' },
        })?.metadata,
      ).toBeUndefined();

      expect(
        getAppErrorData({
          appErrorCode: 'MASTER_KEY_UNAVAILABLE',
          messageKey: 'APP_MASTER_KEY_UNAVAILABLE',
          metadata: { hint: 'UNKNOWN_HINT', reason: 'NO_MATCHING_KEY', storedAccountCount: 1 },
        })?.metadata,
      ).toBeUndefined();
    });

    it('validates generic errors with HINT_RELOGIN or HINT_CLEAR_DATA', () => {
      const reloginData = getAppErrorData({
        appErrorCode: 'DATA_MIGRATION_FAILED',
        messageKey: 'APP_DATA_MIGRATION_FAILED',
        metadata: { hint: 'HINT_RELOGIN' },
      });
      expect(reloginData?.metadata).toEqual({ hint: 'HINT_RELOGIN' });

      const clearData = getAppErrorData({
        appErrorCode: 'DATA_MIGRATION_FAILED',
        messageKey: 'APP_DATA_MIGRATION_FAILED',
        metadata: { hint: 'HINT_CLEAR_DATA' },
      });
      expect(clearData?.metadata).toEqual({ hint: 'HINT_CLEAR_DATA' });

      const invalidHintData = getAppErrorData({
        appErrorCode: 'DATA_MIGRATION_FAILED',
        messageKey: 'APP_DATA_MIGRATION_FAILED',
        metadata: { hint: 'OTHER_HINT' },
      });
      expect(invalidHintData?.metadata).toBeUndefined();
    });
  });
});

describe('shouldReportErrorToSentry', () => {
  it('follows an AppError reportToSentry flag', () => {
    const gated = new AppError('KEYCHAIN_UNAVAILABLE', 'locked', {
      messageKey: 'APP_KEYCHAIN_UNAVAILABLE',
      reportToSentry: false,
      metadata: { hint: null },
    });
    const reporting = new AppError('KEYCHAIN_UNAVAILABLE', 'locked', {
      messageKey: 'APP_KEYCHAIN_UNAVAILABLE',
      metadata: { hint: null },
    });

    expect(shouldReportErrorToSentry(gated)).toBe(false);
    expect(shouldReportErrorToSentry(reporting)).toBe(true);
  });

  it('is true by default so an ordinary error is never silenced', () => {
    expect(shouldReportErrorToSentry(new Error('stock error'))).toBe(true);
    expect(shouldReportErrorToSentry(null)).toBe(true);
    expect(shouldReportErrorToSentry(undefined)).toBe(true);
  });
});
