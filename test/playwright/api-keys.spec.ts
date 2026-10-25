import { expect, loginAsAdmin, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole('button', { name: /^API Keys$/i }).click();
});

test('lists seeded API keys with previews', async ({ page }) => {
  await expect(page.getByText('Playwright admin')).toBeVisible();
  await expect(page.getByText('Playwright client')).toBeVisible();
  // Keys in table show preview format, not full raw key
  await expect(page.getByText(/^sk-ag-[0-9a-f]{2}\.\.\.[0-9a-f]{4}$/).first()).toBeVisible();
});

test('creates a new key, shows raw key once, toggles and deletes it', async ({ page }) => {
  // Open create modal
  await page.getByRole('button', { name: /create new api key|tạo khoá api mới/i }).click();

  // Fill key name
  const nameInput = page.locator('input[required]').first();
  await nameInput.fill('Temp Playwright Key');

  // Submit modal
  await page.getByRole('button', { name: /^create key$|^tạo khoá$/i }).click();

  // Success view reveals the full raw key
  const rawKeyElement = page.locator('span').filter({ hasText: /^sk-ag-[0-9a-f]{48}$/ });
  await expect(rawKeyElement).toBeVisible();
  const rawKey = (await rawKeyElement.textContent())?.trim();
  expect(rawKey).toMatch(/^sk-ag-[0-9a-f]{48}$/);

  // Close creation dialog
  await page.getByRole('button', { name: /done|hoàn tất/i }).click();

  // Key now appears in table with preview format
  const keyRow = page.locator('tr').filter({ hasText: 'Temp Playwright Key' });
  await expect(keyRow).toBeVisible();
  await expect(keyRow).not.toContainText(rawKey!);

  // Toggle active / disabled
  const statusButton = keyRow.getByRole('button', { name: /active|hoạt động/i });
  await statusButton.click();
  await expect(keyRow.getByRole('button', { name: /disabled|vô hiệu/i })).toBeVisible();

  // Delete key
  await keyRow.locator('button[title*="Xoá"], button[title*="Delete"]').click();
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(page.locator('tr').filter({ hasText: 'Temp Playwright Key' })).toHaveCount(0);
});
