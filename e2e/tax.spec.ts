import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetData, signIn, tenantUrl } from './helpers';

/**
 * Tax at checkout and on the invoice (docs/api/commerce.md → Tax). Amplify is registered for UK VAT (added) and EU
 * VAT through the OSS (reverse charge for verified VAT numbers); Northwind for Australian GST (included) and
 * California sales tax. Every figure is the API's.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeEach(async () => {
  await resetData();
});

async function axe(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    label,
  ).toEqual([]);
}

const summary = (page: Page) => page.getByRole('complementary');

async function pay(page: Page, amount: string) {
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.locator('form button[type=submit]', { hasText: `Pay ${amount}` }).click();
  await expect(page.getByRole('heading', { name: 'You’re enrolled!' })).toBeVisible({ timeout: 15_000 });
  return page.url().split('/').at(-1)!;
}

test('a UK buyer sees VAT added, and the paid invoice has its number and the VAT breakdown', async ({ page }) => {
  await signIn(page, 'amplify', '/checkout?course=client-acquisition-sprint');
  await page.getByLabel('Billing country').selectOption('United Kingdom');
  await expect(summary(page).getByText('VAT (20%)')).toBeVisible();
  await expect(summary(page).getByText('$29.80')).toBeVisible();
  // No VAT number field: the UK registration doesn't reverse-charge.
  await expect(page.getByLabel('VAT number (optional)')).toHaveCount(0);
  const orderId = await pay(page, '$178.80');

  await page.goto(tenantUrl('amplify', `/orders/${orderId}/invoice`));
  const invoice = page.getByRole('article', { name: 'Invoice INV-0001' });
  await expect(invoice.getByText('INV-0001', { exact: true })).toBeVisible();
  await expect(invoice.getByText(/^Order #AMP-/)).toBeVisible();
  await expect(invoice.getByRole('columnheader', { name: 'Tax' })).toBeVisible();
  await expect(invoice.getByText('VAT (20%)')).toBeVisible();
  await expect(invoice.getByText('Tax ID: GB123456789', { exact: false })).toBeVisible();
  await axe(page, 'invoice');
});

test('an EU business with a verified VAT number gets the reverse charge', async ({ page }) => {
  await signIn(page, 'amplify', '/checkout?course=client-acquisition-sprint');
  await page.getByLabel('Billing country').selectOption('Germany');
  await expect(summary(page).getByText('VAT (19%)')).toBeVisible();
  const vat = page.getByLabel('VAT number (optional)');
  await vat.fill('DE123456000');
  await expect(page.getByText('This VAT number isn’t registered in VIES.')).toBeVisible();
  await vat.fill('DE123456789');
  await expect(page.getByText('VAT number verified — reverse charge applies')).toBeVisible();
  await expect(summary(page).getByText('Reverse charge', { exact: true })).toBeVisible();
  await expect(summary(page).getByText(/^VAT reverse charge: the customer accounts for VAT/)).toBeVisible();
  await axe(page, 'checkout with VAT number');
  const orderId = await pay(page, '$149');

  await page.goto(tenantUrl('amplify', `/orders/${orderId}/invoice`));
  const invoice = page.getByRole('article', { name: 'Invoice INV-0001' });
  await expect(invoice.getByText('Reverse charge', { exact: true })).toBeVisible();
  await expect(invoice.getByText('VAT number: DE123456789')).toBeVisible();
  await expect(invoice.getByText(/^VAT reverse charge/)).toBeVisible();
  await expect(invoice.getByText('Tax ID: EU372000041', { exact: false })).toBeVisible();
});

test('a US buyer must choose their state, and California sales tax is added', async ({ page }) => {
  await page.goto(tenantUrl('northwind', `/sign-up?next=${encodeURIComponent('/checkout?course=yoga-foundations')}`));
  await page.getByLabel('Full name').fill('Nia Park');
  await page.getByLabel('Email').fill('nia.park@example.com');
  await page.getByLabel('Password', { exact: true }).fill('password-123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();

  // Australian GST is included in the price: shown, not added.
  await page.getByLabel('Billing country').selectOption('Australia');
  await expect(summary(page).getByText('Includes GST (10%)')).toBeVisible();
  await expect(page.locator('form button[type=submit]', { hasText: 'Pay £89' })).toBeVisible();

  await page.getByLabel('Billing country').selectOption('United States');
  const state = page.getByLabel('State or province');
  await expect(state).toBeVisible();
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.locator('form button[type=submit]', { hasText: 'Pay £' }).click();
  await expect(state).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.field-error', { hasText: 'Choose your state or province.' })).toBeVisible();
  await axe(page, 'checkout with state error');

  await state.selectOption('CA');
  await expect(summary(page).getByText('Sales tax (7.25%)')).toBeVisible();
  await expect(summary(page).getByText('£6.45')).toBeVisible();
  await page.locator('form button[type=submit]', { hasText: 'Pay £95.45' }).click();
  await expect(page.getByRole('heading', { name: 'You’re enrolled!' })).toBeVisible({ timeout: 15_000 });
  const orderId = page.url().split('/').at(-1)!;

  await page.goto(tenantUrl('northwind', `/orders/${orderId}/invoice`));
  const invoice = page.getByRole('article', { name: 'Invoice INV-0001' });
  await expect(invoice.getByText('Sales tax (7.25%)')).toBeVisible();
  await expect(invoice.getByText('CA, United States')).toBeVisible();
});
