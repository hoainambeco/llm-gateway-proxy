import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export function applyTempEnv(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const previous = new Map<string, string | undefined>();
  const values: Record<string, string> = {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    SQLITE_DB_PATH: path.join(dir, 'test.sqlite'),
    ACCOUNTS_FILE: path.join(dir, 'accounts.json'),
    ROUTING_CONFIG_PATH: path.join(dir, 'routing.json'),
    DATA_DIR: dir,
  };
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return {
    dir,
    restore() {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}
