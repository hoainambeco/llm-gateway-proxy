import fs from 'node:fs';
import { PW_RUN_DIR } from './seed-data';

/**
 * Removes the isolated Playwright run directory once the suite is done.
 * Only this fixed path is ever touched, so real `./data/` stays untouched.
 */
export default async function globalTeardown(): Promise<void> {
  fs.rmSync(PW_RUN_DIR, {
    recursive: true,
    force: true,
  });
}
