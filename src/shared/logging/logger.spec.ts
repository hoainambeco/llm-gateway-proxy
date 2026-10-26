import { logger } from './logger';

describe('logger', () => {
  const originalDebug = process.env.DEBUG;

  afterEach(() => {
    process.env.DEBUG = originalDebug;
    jest.restoreAllMocks();
  });

  it('logs info with and without metadata', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    logger.info('System startup');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] System startup'));

    logger.info('With meta', { status: 'ok' }, 'extra');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] With meta {"status":"ok"} extra'));
  });

  it('logs warn with and without metadata', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    logger.warn('Rate limit approaching');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[WARN] Rate limit approaching'));

    logger.warn('Warning details', { retryAfter: 8 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[WARN] Warning details {"retryAfter":8}'));
  });

  it('logs error with and without metadata', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    logger.error('Fatal crash');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR] Fatal crash'));

    logger.error('Error info', { traceId: '123' });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR] Error info {"traceId":"123"}'));
  });

  it('handles debug logging depending on process.env.DEBUG', () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});

    delete process.env.DEBUG;
    logger.debug('Hidden debug message');
    expect(debugSpy).not.toHaveBeenCalled();

    process.env.DEBUG = 'true';
    logger.debug('Visible debug message', { detail: true });
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('[DEBUG] Visible debug message {"detail":true}'));
  });

  it('returns empty array from getRecentLogs()', () => {
    expect(logger.getRecentLogs()).toEqual([]);
  });
});
