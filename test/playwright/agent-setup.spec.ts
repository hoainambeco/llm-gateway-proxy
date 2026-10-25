import { expect, loginAsAdmin, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole('button', { name: /^agent setup$/i }).click();
});

test('renders agent presets and generated config snippets', async ({ page }) => {
  // Heading
  await expect(page.getByRole('heading', { name: /^agent setup$/i }).first()).toBeVisible();

  // Presets like Cursor and Claude Code are present
  await expect(page.getByText(/cursor/i).first()).toBeVisible();
  await expect(page.getByText(/claude code/i).first()).toBeVisible();

  // Generated config preview exists and contains the host port and placeholder
  const codeBlock = page.locator('pre');
  await expect(codeBlock).toBeVisible();
  await expect(codeBlock).toContainText('8046');
  await expect(codeBlock).toContainText('<your-api-key>');

  // Switching preset updates the snippet
  await page.getByText(/claude code/i).first().click();
  await expect(codeBlock).toContainText('ANTHROPIC_BASE_URL');
});
