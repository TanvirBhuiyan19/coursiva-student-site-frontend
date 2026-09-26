import { expect, test } from '@playwright/test';
import { hostGet, tenantUrl } from './helpers';

/** One codebase, many schools: each host gets its own brand, locale, currency, content and features. */

test('each tenant renders its own brand, locale and currency', async ({ page }) => {
  await page.goto(tenantUrl('northwind', '/'));
  await expect(page).toHaveTitle(/Northwind Yoga/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
  const brand = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim());
  expect(brand).toContain(' 158'); // Emerald hue

  await page.goto(tenantUrl('northwind', '/courses'));
  await expect(page.getByText('£89').first()).toBeVisible();

  await page.goto(tenantUrl('amplify', '/'));
  const amplifyBrand = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim());
  expect(amplifyBrand).toContain(' 275'); // Indigo hue
});

test('navigation follows plan entitlements', async ({ page }) => {
  await page.goto(tenantUrl('northwind', '/'));
  const nav = page.getByRole('navigation', { name: 'Main' }).first();
  await expect(nav.getByRole('link', { name: 'Community' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Membership' })).toHaveCount(0);
  expect((await hostGet(page.request, 'northwind.localhost:3100', '/membership')).status()).toBe(404);

  await page.goto(tenantUrl('amplify', '/'));
  await expect(page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'Community' })).toBeVisible();
});

test('white-label tenants hide the platform credit', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/'));
  await expect(page.getByText('Powered by Coursiva')).toBeVisible();
  await page.goto(tenantUrl('northwind', '/'));
  await expect(page.getByText('Powered by Coursiva')).toHaveCount(0);
});

test('custom domains redirect to the canonical host', async ({ request }) => {
  const res = await hostGet(request, 'learn.northwindyoga.test:3100', '/courses', { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(res.headers().location).toBe(tenantUrl('northwind', '/courses'));
});
