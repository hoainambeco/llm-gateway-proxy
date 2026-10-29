import { expect, test, loginAsAdmin } from './fixtures';
import { PW_CLIENT_KEY_ID } from './seed-data';

test.describe('Audit Logs View', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('navigation').getByRole('button', { name: /traffic|nhật ký|logs/i }).click();
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
    await page.getByRole('navigation').getByRole('button', { name: /^token analytics$|^thống kê token$/i }).click();
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

  test('interacts with time range presets, switches chart metrics, and exports CSV', async ({ page }) => {
    // 1. Click "7 Days" preset
    const sevenDaysBtn = page.getByRole('button', { name: /7 days|7 ngày/i });
    await sevenDaysBtn.click();
    await expect(sevenDaysBtn).toHaveClass(/bg-emerald-600/);

    // 2. Click "30 Days" preset
    const thirtyDaysBtn = page.getByRole('button', { name: /30 days|30 ngày/i });
    await thirtyDaysBtn.click();
    await expect(thirtyDaysBtn).toHaveClass(/bg-emerald-600/);

    // 3. Click "Custom" preset and verify custom date range inputs appear
    const customBtn = page.getByRole('button', { name: /custom|tùy chọn/i });
    await customBtn.click();
    const dateInputs = page.locator('input[type="date"]');
    await expect(dateInputs).toHaveCount(2);

    // 4. Switch chart metric from Tokens to Requests
    const requestsMetricBtn = page.getByRole('button', { name: /^requests$/i });
    await requestsMetricBtn.click();
    await expect(page.getByText(/request volume over time/i)).toBeVisible();

    // 5. Switch back to Tokens metric
    const tokensMetricBtn = page.getByRole('button', { name: /^tokens$/i });
    await tokensMetricBtn.click();
    await expect(page.getByText(/token usage over time/i)).toBeVisible();

    // 6. Test Export CSV button and verify download is initiated
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /export csv|xuất csv/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.csv');
  });
});
