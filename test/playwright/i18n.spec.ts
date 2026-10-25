import { expect, loginAsAdmin, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('toggles language between Vietnamese and English, persists across reloads', async ({ page }) => {
  const languageGroup = page.getByRole('group', { name: 'Language selector' });

  // Switch to Vietnamese
  await languageGroup.getByRole('button', { name: /VI/i }).click();

  // Check Vietnamese navigation labels
  await expect(page.getByRole('button', { name: /tài khoản & quota/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /thêm vào agent/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /đăng xuất/i })).toBeVisible();

  // Reload page and verify language persisted in localStorage
  await page.reload();
  await expect(page.getByRole('button', { name: /tài khoản & quota/i })).toBeVisible();

  // Switch back to English
  await languageGroup.getByRole('button', { name: /EN/i }).click();
  await expect(page.getByRole('button', { name: /accounts & quota/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /agent setup/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /log out/i })).toBeVisible();

  // Verify no raw translation keys are leaked on screen
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(/navigation\./);
  expect(bodyText).not.toMatch(/dashboard\./);
});
