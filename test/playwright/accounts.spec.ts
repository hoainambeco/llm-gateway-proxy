import { expect, loginAsAdmin, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole('navigation').getByRole('button', { name: /accounts|tài khoản/i }).click();
});

test('searches and filters seeded accounts', async ({ page }) => {
  await expect(page.getByTestId('account-row')).toHaveCount(3);

  await page.getByTestId('accounts-search').fill('disabled');
  await expect(page.getByTestId('account-row')).toHaveCount(1);
  await expect(page.getByTestId('account-disabled-badge')).toBeVisible();

  await page.getByTestId('accounts-search').fill('');
  await page.getByTestId('accounts-status-filter').selectOption('disabled');
  await expect(page.getByTestId('account-row')).toHaveCount(1);
});

test('renames an account and persists after reload', async ({ page }) => {
  await page.getByTestId('account-edit-name').first().click();
  await page.getByTestId('account-name-input').fill('Renamed in test');
  await page.getByTestId('account-save-name').click();
  await expect(page.getByTestId('account-name').first()).toContainText(
    'Renamed in test',
  );

  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: /accounts|tài khoản/i }).click();
  await expect(page.getByTestId('account-name').first()).toContainText(
    'Renamed in test',
  );
});

test('disables and re-enables an account', async ({ page }) => {
  const row = page
    .getByTestId('account-row')
    .filter({ hasText: 'active@test.local' });
  await row.getByTestId('account-toggle-active').click();
  // The row's own action button may also read "Disable"; the shared confirm
  // modal button is the unambiguous target.
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(row.getByTestId('account-disabled-badge')).toBeVisible();

  await row.getByTestId('account-toggle-active').click();
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(row.getByTestId('account-disabled-badge')).toHaveCount(0);
});

test('deletes a disposable account', async ({ page, request, adminKey }) => {
  const created = await request.post('/internal/accounts', {
    headers: { Authorization: `Bearer ${adminKey}` },
    data: { provider: 'google', email: 'delete-me@test.local' },
  });
  expect(created.ok()).toBeTruthy();

  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: /accounts|tài khoản/i }).click();
  const row = page
    .getByTestId('account-row')
    .filter({ hasText: 'delete-me@test.local' });
  await expect(row).toHaveCount(1);
  await row.getByTestId('account-delete').click();
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(
    page.getByTestId('account-row').filter({ hasText: 'delete-me@test.local' }),
  ).toHaveCount(0);
});
