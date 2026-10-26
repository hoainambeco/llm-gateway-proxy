import { expect, loginAsAdmin, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole('navigation').getByRole('button', { name: /^models & routing$/i }).click();
});

test('displays model catalog and quick setup guide', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /model catalog/i }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /connection guide/i })).toBeVisible();

  // Search input filters models
  const searchInput = page.getByPlaceholder(/search models|tìm kiếm/i);
  await expect(searchInput).toBeVisible();

  await searchInput.fill('gemini');
  await expect(page.locator('div').filter({ hasText: /gemini/i }).first()).toBeVisible();

  // Clear search and test copy button
  await searchInput.fill('');
  const copyBtn = page.locator('button[title*="Sao chép"], button[title*="Copy"]').first();
  await expect(copyBtn).toBeVisible();
  await copyBtn.click();
});
