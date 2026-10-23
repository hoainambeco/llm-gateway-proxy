import { expect, test } from '@playwright/test';

test('serves the app shell', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/LLM Gateway/i);
});
