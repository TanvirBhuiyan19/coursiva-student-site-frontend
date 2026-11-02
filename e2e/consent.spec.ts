import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { hostGet, resetData, tenantUrl } from './helpers';

/**
 * Cookie consent on school sites (docs/consent.md). Northwind has its cookie banner on (opt-in) and head code with an
 * analytics script and an unmarked (marketing) pixel; Amplify has the banner off (opt-out).
 */

test.beforeEach(async () => {
  await resetData();
});

// `maya` is the mock's Active partner: its click is recorded and kept (an unknown partner keeps nothing).
const LANDING = '/?utm_source=newsletter&gclid=g-123&fbclid=f-9&ref=maya';
const flags = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __northwindAnalytics?: boolean; __northwindPixel?: boolean };
    return { analytics: w.__northwindAnalytics === true, pixel: w.__northwindPixel === true };
  });
const stored = (page: Page) =>
  page.evaluate(() => ({
    acquisition: sessionStorage.getItem('coursiva:acquisition'),
    ref: localStorage.getItem('coursiva:ref'),
    cookies: document.cookie,
  }));

test('nothing non-essential runs or is stored before consent, and Decline keeps it that way', async ({ page }) => {
  const clicks: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/affiliates/')) clicks.push(r.url());
  });
  await page.goto(tenantUrl('northwind', LANDING));
  const banner = page.getByRole('region', { name: 'Cookie notice' });
  await expect(banner).toBeVisible();
  // Passive head code (verification meta) is server-rendered; scripts are not.
  await expect(page.locator('head meta[name="northwind-verification"]')).toHaveAttribute('content', 'nw-1');
  await expect(page.locator('head script', { hasText: '__northwind' })).toHaveCount(0);
  expect(await flags(page)).toEqual({ analytics: false, pixel: false });
  expect(await stored(page)).toMatchObject({ acquisition: null, ref: null });
  expect((await stored(page)).cookies).not.toContain('_fbp');

  await banner.getByRole('button', { name: 'Decline' }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0);
  expect(await flags(page)).toEqual({ analytics: false, pixel: false });
  expect(await stored(page)).toMatchObject({ acquisition: null, ref: null });
  expect(clicks).toEqual([]);
  // Essential cookies keep working: the session/CSRF handshake still sets XSRF-TOKEN when needed.
  expect(await page.evaluate(() => document.documentElement.dataset.cookieConsent)).toBe('declined');
});

test('choosing analytics only runs the analytics script; changing the choice later in the footer adds marketing', async ({ page }) => {
  await page.goto(tenantUrl('northwind', LANDING));
  const banner = page.getByRole('region', { name: 'Cookie notice' });
  await banner.getByRole('button', { name: 'Choose cookies' }).click();
  await banner.getByRole('checkbox', { name: /Analytics/ }).check();
  await banner.getByRole('button', { name: 'Save choices' }).click();
  await expect.poll(() => flags(page)).toEqual({ analytics: true, pixel: false });
  const first = await stored(page);
  expect(first.acquisition).toContain('newsletter');
  expect(first.acquisition).not.toContain('g-123');
  expect(first.ref).toBeNull();

  await page.getByRole('contentinfo').getByRole('button', { name: 'Cookie settings' }).click();
  const panel = page.getByRole('region', { name: 'Cookie notice' });
  await panel.getByRole('checkbox', { name: /Marketing/ }).check();
  await panel.getByRole('button', { name: 'Save choices' }).click();
  await expect.poll(() => flags(page)).toEqual({ analytics: true, pixel: true });
  await expect.poll(async () => (await stored(page)).acquisition).toContain('g-123');
  await expect.poll(async () => (await stored(page)).ref).toContain('"value":"maya"');
});

test('withdrawing marketing forgets click ids and tracker cookies and stops the pixel', async ({ page }) => {
  await page.goto(tenantUrl('northwind', LANDING));
  await page.getByRole('region', { name: 'Cookie notice' }).getByRole('button', { name: 'Accept' }).click();
  await expect.poll(() => flags(page)).toEqual({ analytics: true, pixel: true });
  await expect.poll(async () => (await stored(page)).cookies).toContain('_fbp');

  await page.getByRole('contentinfo').getByRole('button', { name: 'Cookie settings' }).click();
  const panel = page.getByRole('region', { name: 'Cookie notice' });
  await panel.getByRole('checkbox', { name: /Marketing/ }).uncheck();
  // The pixel already ran, so the page reloads to stop it.
  await Promise.all([page.waitForEvent('load'), panel.getByRole('button', { name: 'Save choices' }).click()]);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect.poll(() => flags(page)).toEqual({ analytics: true, pixel: false });
  const after = await stored(page);
  expect(after.cookies).not.toContain('_fbp');
  expect(after.acquisition).not.toContain('g-123');
  expect(after.ref).toBeNull();
});

test('Global Privacy Control keeps marketing off', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true });
  });
  const page = await context.newPage();
  await page.goto(tenantUrl('northwind', LANDING));
  await page.getByRole('region', { name: 'Cookie notice' }).getByRole('button', { name: 'Accept' }).click();
  await expect.poll(() => flags(page)).toEqual({ analytics: true, pixel: false });
  expect((await stored(page)).acquisition).not.toContain('g-123');
  await page.getByRole('contentinfo').getByRole('button', { name: 'Cookie settings' }).click();
  await expect(page.getByRole('checkbox', { name: /Marketing/ })).toBeDisabled();
  await context.close();
});

test('with the banner off the school’s code runs, and the visitor can still opt out in the footer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __amplifyHead?: boolean }).__amplifyHead)).toBe(true);
  await page.getByRole('contentinfo').getByRole('button', { name: 'Cookie settings' }).click();
  const panel = page.getByRole('region', { name: 'Cookie notice' });
  await panel.getByRole('button', { name: 'Decline' }).click();
  await page.waitForLoadState('load');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __amplifyHead?: boolean }).__amplifyHead)).toBeUndefined();
});

test('code-free pages never receive the school’s code, not even in their payload', async ({ request }) => {
  // The server decides from the path (the layout's `@code` slot): the code's text is in the home page's HTML only.
  expect(await (await hostGet(request, 'amplify.localhost:3100', '/')).text()).toContain('__amplifyHead');
  for (const path of ['/sign-in', '/forgot-password', '/checkout?course=funnel-blueprint']) {
    const html = await (await hostGet(request, 'amplify.localhost:3100', path)).text();
    expect(html, path).not.toContain('__amplifyHead');
  }
});

test('the cookie choices are accessible (WCAG 2.2 AA), desktop and phone', async ({ page }) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(tenantUrl('northwind', '/'));
    await page.getByRole('region', { name: 'Cookie notice' }).getByRole('button', { name: 'Choose cookies' }).click();
    await expect(page.getByRole('checkbox', { name: /Analytics/ })).toBeVisible();
    const { violations } = await new AxeBuilder({ page })
      .include('[aria-label="Cookie notice"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
  }
});
