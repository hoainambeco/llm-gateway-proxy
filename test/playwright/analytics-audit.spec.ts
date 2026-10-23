import { expect, test, loginAsAdmin } from './fixtures';
import { PW_CLIENT_KEY_ID } from './seed-data';

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole('button', { name: /traffic|nhật ký|logs/i }).click();
});

test('filters audit rows by time range', async ({ page }) => {
  await expect(page.getByTestId('audit-row')).toHaveCount(3);

  await page.getByTestId('audit-from').fill('2026-10-01T00:30');
  await page.getByTestId('audit-to').fill('2026-10-01T02:30');
  await expect(page.getByTestId('audit-row')).toHaveCount(2);
});

test('filters audit rows by api key and clears filters', async ({ page }) => {
  await page.getByTestId('audit-apikey-filter').selectOption(PW_CLIENT_KEY_ID);
  await expect(page.getByTestId('audit-row')).toHaveCount(1);
  await expect(page.getByTestId('audit-row')).toContainText('429');

  await page.getByTestId('audit-clear-filters').click();
  await expect(page.getByTestId('audit-row')).toHaveCount(3);
});
