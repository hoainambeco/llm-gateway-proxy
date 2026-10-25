import { expect, loginAsAdmin, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole('button', { name: /^routing rules$/i }).click();
});

test('displays seeded routing rules and default pipeline', async ({ page }) => {
  // Heading and visual mode
  await expect(page.getByRole('heading', { name: /model routing/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /add rule|thêm quy tắc/i })).toBeVisible();

  // Default pipeline card is visible
  await expect(page.getByText(/default pipeline|chuỗi xử lý mặc định/i)).toBeVisible();
});

test('adds a custom routing rule, saves, and persists across reloads', async ({ page, request, adminKey }) => {
  // Get initial routing config to restore later
  const originalRes = await request.get('/internal/routing', {
    headers: { Authorization: `Bearer ${adminKey}` },
  });
  const originalConfig = await originalRes.json();

  try {
    // Open Add Rule modal
    await page.getByRole('button', { name: /add rule|thêm quy tắc/i }).click();

    // Fill pattern and description using placeholders
    const patternInput = page.locator('input[placeholder*="claude"]').first();
    await patternInput.fill('test-custom-pattern-*');

    const descInput = page.locator('input[placeholder*="Prioritize"], input[placeholder*="ưu tiên"]').first();
    await descInput.fill('E2E Test Rule');

    // Save modal
    await page.getByRole('button', { name: /save rule|lưu quy tắc/i }).click();

    // Verify new rule is rendered in list
    await expect(page.getByText('test-custom-pattern-*')).toBeVisible();

    // Reload and verify persisted
    await page.reload();
    await page.getByRole('button', { name: /^routing rules$/i }).click();
    await expect(page.getByText('test-custom-pattern-*')).toBeVisible();
  } finally {
    // Restore original routing configuration
    await request.post('/internal/routing', {
      headers: {
        Authorization: `Bearer ${adminKey}`,
        'Content-Type': 'application/json',
      },
      data: originalConfig,
    });
  }
});
