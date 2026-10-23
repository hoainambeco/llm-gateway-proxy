import { test as base, type Page } from '@playwright/test';
import { PW_ADMIN_KEY, PW_CLIENT_KEY } from './seed-data';

export { expect } from '@playwright/test';

export const test = base.extend<{ adminKey: string; clientKey: string }>({
  adminKey: async (_fixtures, use) => use(PW_ADMIN_KEY),
  clientKey: async (_fixtures, use) => use(PW_CLIENT_KEY),
});

export async function loginAsAdmin(page: Page, key = PW_ADMIN_KEY) {
  await page.addInitScript(
    ([k]) => window.sessionStorage.setItem('antigravity_admin_key', k),
    [key],
  );
  await page.goto('/');
}
