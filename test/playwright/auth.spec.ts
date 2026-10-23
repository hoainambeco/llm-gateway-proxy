import { expect, test } from './fixtures';
import { PW_CLIENT_KEY } from './seed-data';

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
