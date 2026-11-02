import { expect, test, type Page } from '@playwright/test';
import { resetData, signIn, tenantUrl } from './helpers';

/** Gift cards at checkout (docs/api/commerce.md → gift_card): a tender after the total, its own field. */

test.beforeEach(async () => {
  await resetData();
});

async function applyGiftCard(page: Page, code: string) {
  await page.getByRole('button', { name: 'Have a gift card?' }).click();
  await page.getByLabel('Gift card').fill(code);
  await page.getByRole('button', { name: 'Apply', exact: true }).last().click();
}

test('a gift card that covers everything skips the payment step', async ({ page }) => {
  await signIn(page, 'amplify', '/checkout?product=launch-kit');
  await applyGiftCard(page, 'gift-test-0050');
  await expect(page.getByText('Gift card applied: $19')).toBeVisible();
  await expect(page.getByText('To pay now')).toBeVisible();
  await expect(page.getByText('Test card')).toHaveCount(0);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.locator('form button[type=submit]', { hasText: 'paid by gift card' }).click();
  await expect(page.getByRole('heading', { name: 'Your download is ready!' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Paid with gift card')).toBeVisible();
});

test('a smaller gift card pays part; the card is charged the rest and the invoice shows both', async ({ page }) => {
  await signIn(page, 'amplify', '/checkout?course=pricing-with-confidence');
  await applyGiftCard(page, 'GIFT-HALF-0025');
  await expect(page.getByText('Gift card applied: $25')).toBeVisible();
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.locator('form button[type=submit]', { hasText: 'Pay $74' }).click();
  await expect(page.getByRole('heading', { name: 'You’re enrolled!' })).toBeVisible({ timeout: 15_000 });
  const orderId = page.url().split('/').at(-1)!;
  await page.goto(tenantUrl('amplify', `/orders/${orderId}/invoice`));
  await expect(page.getByText('Gift card (GIFT-••••-0025)')).toBeVisible();
  await expect(page.getByText('Paid by card')).toBeVisible();
});
