import fs from 'node:fs';
import path from 'node:path';

/**
 * Removes the isolated Playwright run directory once the suite is done.
 * Only this fixed path is ever touched, so real `./data/` stays untouched.
 */
export default async function globalTeardown(): Promise<void> {
  fs.rmSync(path.join(process.cwd(), 'test/.tmp/pw'), {
    recursive: true,
    force: true,
  });
}
