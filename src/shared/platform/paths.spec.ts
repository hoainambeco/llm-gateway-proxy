import path from 'path';
import os from 'os';
import { getAgentDir, getProxyStateDir } from './paths';

describe('paths', () => {
  const originalDataDir = process.env.DATA_DIR;

  afterEach(() => {
    process.env.DATA_DIR = originalDataDir;
  });

  it('uses DATA_DIR when set', () => {
    process.env.DATA_DIR = '/custom/proxy/dir';
    expect(getAgentDir()).toBe('/custom/proxy/dir');
    expect(getProxyStateDir()).toBe(path.join('/custom/proxy/dir', 'proxy-state'));
  });

  it('falls back to user home directory when DATA_DIR is unset', () => {
    delete process.env.DATA_DIR;
    const expected = path.join(os.homedir(), '.llm-gateway-proxy');
    expect(getAgentDir()).toBe(expected);
    expect(getProxyStateDir()).toBe(path.join(expected, 'proxy-state'));
  });
});
