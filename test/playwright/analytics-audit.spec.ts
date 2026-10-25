import { expect, test, loginAsAdmin } from './fixtures';
import { PW_CLIENT_KEY_ID } from './seed-data';

test.describe('Audit Logs View', () => {
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
});

test.describe('Analytics View', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('button', { name: /^token analytics$|^thống kê token$/i }).click();
  });

  test('renders analytics summary cards, export button, and time series chart', async ({ page }) => {
    // Top headers and controls
    await expect(page.getByRole('heading', { name: /token analytics|thống kê token/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /export csv|xuất csv/i })).toBeVisible();

    // Time series chart SVG is rendered
    await expect(page.locator('svg').first()).toBeVisible();

    // Preset buttons exist (e.g. 24 Hours, 7 Days)
    await expect(page.getByRole('button', { name: /24 hours|24 giờ/i })).toBeVisible();
  });
});
