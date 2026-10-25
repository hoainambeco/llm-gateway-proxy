import { expect, loginAsAdmin, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('renders dashboard summary cards and navigation', async ({ page }) => {
  // Welcome banner and action buttons
  await expect(page.getByRole('button', { name: /view accounts|xem tài khoản/i })).toBeVisible();

  // Accounts card shows count of accounts
  const accountsCard = page.locator('div').filter({ hasText: /accounts|tài khoản/i }).first();
  await expect(accountsCard).toBeVisible();

  // Navigation from dashboard card to accounts view
  await page.getByRole('button', { name: /view accounts|xem tài khoản/i }).click();
  await expect(page.getByTestId('account-row')).toHaveCount(3);

  // Return to dashboard via sidebar
  await page.getByRole('button', { name: /dashboard|tổng quan/i }).click();
  await expect(page.getByRole('button', { name: /view accounts|xem tài khoản/i })).toBeVisible();
});
