import type { Page } from '@playwright/test';
import { expect, loginAsAdmin, test } from './fixtures';
import { PW_CLIENT_KEY } from './seed-data';

const STORED_KEY = 'antigravity_admin_key';

/** Paths that must never be called before the session is authenticated. */
function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/internal') || pathname === '/graphql';
}

function captureApiCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (isApiPath(pathname)) calls.push(pathname);
  });
  return calls;
}

async function expectLoggedOut(page: Page): Promise<void> {
  await expect(page.getByTestId('login-key-input')).toBeVisible();
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), STORED_KEY),
  ).toBeNull();
}

test('shows the login screen when no key is stored', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('login-key-input')).toBeVisible();
});

test('rejects empty, wrong, and client-role keys', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toBeVisible();

  await page.getByTestId('login-key-input').fill('sk-ag-not-a-real-key');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toContainText(/invalid/i);

  await page.getByTestId('login-key-input').fill(PW_CLIENT_KEY);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toContainText(/admin/i);
});

test('logs in with an admin key, survives reload, and logs out', async ({
  page,
  adminKey,
}) => {
  await page.goto('/');
  await page.getByTestId('login-key-input').fill(adminKey);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('logout-button')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('logout-button')).toBeVisible();

  await page.getByTestId('logout-button').click();
  await expect(page.getByTestId('login-key-input')).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem('antigravity_admin_key')),
  ).toBeNull();
});

test('drops an invalid stored key back to login', async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem('antigravity_admin_key', 'sk-ag-stale'),
  );
  await page.goto('/');
  await expect(page.getByTestId('login-key-input')).toBeVisible();
});

test('makes no API calls before authentication', async ({ page }) => {
  const calls = captureApiCalls(page);

  await page.goto('/');
  await expect(page.getByTestId('login-key-input')).toBeVisible();
  // Give any stray mount effect time to fire before asserting.
  await page.waitForTimeout(500);

  expect(calls).toEqual([]);
});

test('during session revalidation only the validate probe is called', async ({
  page,
  adminKey,
}) => {
  const calls = captureApiCalls(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route('**/internal/auth/validate', async (route) => {
    await gate;
    await route.continue();
  });
  await page.addInitScript(
    ([key]) => sessionStorage.setItem('antigravity_admin_key', key),
    [adminKey],
  );

  await page.goto('/');
  await expect.poll(() => calls.length).toBeGreaterThan(0);
  expect(calls).toEqual(['/internal/auth/validate']);
  await expect(page.getByTestId('login-key-input')).toHaveCount(0);

  release();
  await expect(page.getByTestId('logout-button')).toBeVisible();
});

test('a REST 401 drops the dashboard back to login', async ({
  page,
  adminKey,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  // Hold the first dashboard call so the login can be observed before the 401.
  await page.route('**/internal/system/status', async (route) => {
    await gate;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Admin API key validation failed' }),
    });
  });

  await page.goto('/');
  await page.getByTestId('login-key-input').fill(adminKey);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('logout-button')).toBeVisible();

  release();
  await expectLoggedOut(page);
});

test('a GraphQL 401 drops the dashboard back to login', async ({
  page,
  adminKey,
}) => {
  // The dashboard issues its own quota query on mount; let it settle before
  // routing GraphQL, otherwise the 401 fires on page load instead of Analytics.
  const initialStats = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/graphql',
  );
  await loginAsAdmin(page, adminKey);
  await expect(page.getByTestId('logout-button')).toBeVisible();
  await initialStats;

  await page.route('**/graphql', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Admin API key validation failed' }),
    }),
  );

  // Analytics loads its data through GraphQL; its /internal/api-keys call is
  // intentionally left alone.
  await page.getByRole('navigation').getByRole('button', { name: 'Token Analytics' }).click();
  await expectLoggedOut(page);
});
