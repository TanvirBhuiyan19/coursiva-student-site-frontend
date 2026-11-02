import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { jsonLd, resetData, signIn, tenantUrl } from './helpers';

/** Tier-1 learner flows: billing (card + membership), order history, invoices (status, seller, email copy), help centre. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

test.beforeEach(async () => {
  await resetData();
});

test('billing shows the saved card and leads to the order history, invoices and an emailed copy', async ({ page }) => {
  await signIn(page, 'amplify', '/account/billing');
  const billing = page.getByRole('region', { name: 'Billing' });
  await expect(billing.getByText('Card ending 4242')).toBeVisible();
  await expect(billing.getByRole('button', { name: 'Update card' })).toBeVisible();
  await billing.getByRole('link', { name: 'Order history →' }).click();

  await page.waitForURL((u) => u.pathname === '/account/orders');
  await expect(page.getByRole('heading', { level: 1, name: 'Order history' })).toBeVisible();
  const rows = page.getByRole('listitem').filter({ hasText: /^.*Order #AMP-2026-/ });
  await expect(rows).toHaveCount(4);
  const refunded = rows.filter({ hasText: 'AMP-2026-1000' });
  await expect(refunded.getByText('Partially refunded')).toBeVisible();
  await expect(refunded.getByText('$10 refunded')).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);

  await refunded.getByRole('link', { name: 'Invoice for order AMP-2026-1000' }).click();
  await page.waitForURL((u) => u.pathname === '/orders/ord_1000/invoice');
  const invoice = page.getByRole('article');
  await expect(invoice.getByText('PARTIALLY REFUNDED', { exact: true })).toBeVisible();
  await expect(invoice.getByText('Tax ID: GB123456789', { exact: false })).toBeVisible();
  await expect(invoice.getByText('12 Market Street', { exact: false })).toBeVisible();
  await expect(invoice.getByText('Partially refunded', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: 'Email me a copy' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Invoice sent to jordan.tate@gmail.com' })).toBeVisible();

  await page.getByRole('link', { name: '← Order history' }).click();
  await page.waitForURL((u) => u.pathname === '/account/orders');
});

test('the dashboard lists recent purchases and links to every order', async ({ page }) => {
  await signIn(page);
  const purchases = page.getByRole('region', { name: 'Purchase history' }).first();
  await expect(purchases.getByRole('row')).toHaveCount(5);
  await page.getByRole('link', { name: 'All orders and invoices →' }).click();
  await page.waitForURL((u) => u.pathname === '/account/orders');
});

test('help articles open from the help centre and search, with their own SEO', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/help'));
  await page.getByRole('link', { name: 'Find your invoice' }).click();
  await page.waitForURL((u) => u.pathname === '/help/find-your-invoice');
  await expect(page.getByRole('heading', { level: 1, name: 'Find your invoice' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Need a company invoice?' })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/help\/find-your-invoice$/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Every order has an invoice/);
  expect((await jsonLd(page)).some((b) => b['@type'] === 'Article' && b.headline === 'Find your invoice')).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);

  await page.goto(tenantUrl('amplify', '/help'));
  await page.getByRole('searchbox', { name: 'Search help articles' }).fill('company vat');
  const result = page.getByRole('link', { name: /Find your invoice/ });
  await expect(result).toBeVisible();
  await result.click();
  await page.waitForURL((u) => u.pathname === '/help/find-your-invoice');

  const missing = await page.goto(tenantUrl('amplify', '/help/no-such-article'));
  expect(missing?.status()).toBe(404);
});
