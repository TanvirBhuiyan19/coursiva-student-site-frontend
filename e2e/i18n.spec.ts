import { expect, test } from '@playwright/test';
import { hostGet, tenantUrl } from './helpers';

/**
 * Multi-language routing, on the `polyglot` test tenant (en-US default, es-ES, ar). The UI catalogues for es/ar don't
 * exist yet, so copy falls back to English — these tests cover URLs, SEO signals, direction and link localisation.
 */
const HOST = 'polyglot.localhost:3100';

test('each language has its own URL with lang, canonical and hreflang alternates', async ({ page }) => {
  await page.goto(tenantUrl('polyglot', '/es/courses'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-ES');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', tenantUrl('polyglot', '/es/courses'));
  const alternates = await page
    .locator('link[rel="alternate"][hreflang]')
    .evaluateAll((els) => Object.fromEntries(els.map((e) => [e.getAttribute('hreflang'), e.getAttribute('href')])));
  expect(alternates).toEqual({
    'en-US': tenantUrl('polyglot', '/courses'),
    'es-ES': tenantUrl('polyglot', '/es/courses'),
    ar: tenantUrl('polyglot', '/ar/courses'),
    'x-default': tenantUrl('polyglot', '/courses'),
  });
});

test('links stay in the current language', async ({ page }) => {
  await page.goto(tenantUrl('polyglot', '/es'));
  const nav = page.getByRole('navigation', { name: 'Main' }).first();
  await expect(nav.getByRole('link', { name: 'Courses' })).toHaveAttribute('href', '/es/courses');
  await nav.getByRole('link', { name: 'Courses' }).click();
  await expect(page).toHaveURL(tenantUrl('polyglot', '/es/courses'));
  await expect(nav.getByRole('link', { name: 'Courses' })).toHaveAttribute('aria-current', 'page');
});

test('right-to-left languages set dir="rtl" and mirror the layout', async ({ page }) => {
  await page.goto(tenantUrl('polyglot', '/ar/courses'));
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  // The header brand sits at the inline start — the right edge in RTL.
  const box = await page.getByRole('link', { name: /Polyglot Academy home/ }).boundingBox();
  expect(box!.x).toBeGreaterThan(600);
});

test('the default locale has a single URL and unknown languages 404', async ({ request }) => {
  const dup = await hostGet(request, HOST, '/en/courses', { maxRedirects: 0 });
  expect(dup.status()).toBe(308);
  expect(dup.headers().location).toMatch(/\/courses$/);
  expect((await hostGet(request, HOST, '/fr/courses')).status()).toBe(404);
});

test('guests are sent to sign-in in their own language', async ({ request }) => {
  const res = await hostGet(request, HOST, '/es/learning', { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers().location).toMatch(/\/es\/sign-in\?next=%2Flearning$/);
});

test('the sitemap lists every language with hreflang alternates', async ({ request }) => {
  const xml = await (await hostGet(request, HOST, '/sitemap.xml')).text();
  expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  expect(xml).toContain(`<loc>${tenantUrl('polyglot', '/ar/courses/the-funnel-blueprint')}</loc>`);
  expect(xml).toContain(`hreflang="es-ES" href="${tenantUrl('polyglot', '/es/courses/the-funnel-blueprint')}"`);
  expect(xml).toContain('hreflang="x-default"');
});

test('single-language tenants are unchanged: no prefixes, no alternates', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/courses'));
  await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'Courses' })).toHaveAttribute(
    'href',
    '/courses',
  );
});
