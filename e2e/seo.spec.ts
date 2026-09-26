import { expect, test } from '@playwright/test';
import { hostGet, jsonLd, tenantUrl } from './helpers';

/** What crawlers see: server-rendered HTML, canonical URLs, structured data, robots and sitemaps — per tenant. */

test('home is server-rendered with metadata and organisation data', async ({ request, page }) => {
  const html = await (await hostGet(request, 'amplify.localhost:3100', '/')).text();
  // Content is in the initial HTML, not rendered by client JS.
  expect(html).toContain('Marketing skills that grow your business');
  expect(html).toContain('The Funnel Blueprint');

  await page.goto('/');
  await expect(page).toHaveTitle('Amplify Coaching — Marketing courses that grow your business');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', tenantUrl('amplify', ''));
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Practical marketing courses/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  const types = (await jsonLd(page)).map((d) => d['@type']);
  expect(types).toEqual(expect.arrayContaining(['EducationalOrganization', 'WebSite']));
});

test('course page carries Course, Offer, rating, breadcrumb and FAQ data', async ({ page, request }) => {
  const html = await (await hostGet(request, 'amplify.localhost:3100', '/courses/the-funnel-blueprint')).text();
  // Every tab's content is in the HTML (tabs only toggle visibility), so curriculum and reviews are indexable.
  expect(html).toContain('Pricing psychology');
  expect(html).toContain('I rebuilt my whole funnel');

  await page.goto('/courses/the-funnel-blueprint');
  await expect(page).toHaveTitle('The Funnel Blueprint · Amplify Coaching');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', tenantUrl('amplify', '/courses/the-funnel-blueprint'));
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/courses\/the-funnel-blueprint\/og\.png$/);
  const data = await jsonLd(page);
  const course = data.find((d) => d['@type'] === 'Course') as {
    offers: { price: string; priceCurrency: string };
    aggregateRating: { ratingValue: number };
  };
  expect(course.offers).toMatchObject({ price: '249.00', priceCurrency: 'USD' });
  expect(course.aggregateRating.ratingValue).toBe(4.9);
  expect(data.map((d) => d['@type'])).toEqual(expect.arrayContaining(['BreadcrumbList', 'FAQPage']));
});

test('og image renders in the tenant brand', async ({ request }) => {
  const res = await hostGet(request, 'amplify.localhost:3100', '/courses/the-funnel-blueprint/og.png');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/png');
});

test('robots.txt and sitemap.xml are per tenant', async ({ request }) => {
  const robots = await (await hostGet(request, 'northwind.localhost:3100', '/robots.txt')).text();
  expect(robots).toContain(`Sitemap: ${tenantUrl('northwind', '/sitemap.xml')}`);
  expect(robots).toContain('Disallow: /learning');

  const sitemap = await (await hostGet(request, 'northwind.localhost:3100', '/sitemap.xml')).text();
  expect(sitemap).toContain(tenantUrl('northwind', '/courses/yoga-foundations'));
  expect(sitemap).not.toContain('the-funnel-blueprint');
  // Northwind has no membership on its plan, so no membership URL.
  expect(sitemap).not.toContain('/membership');
});

test('account and transactional pages are noindex', async ({ page }) => {
  for (const path of ['/sign-in', '/cart']) {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  }
});

test('guests are sent to sign-in from private pages, with a safe return path', async ({ page }) => {
  await page.goto('/learning');
  await expect(page).toHaveURL(tenantUrl('amplify', '/sign-in?next=%2Flearning'));
});

test('unknown hosts get a 404 without leaking another tenant', async ({ request }) => {
  const res = await hostGet(request, 'ghost.localhost:3100', '/');
  expect(res.status()).toBe(404);
  expect(await res.text()).not.toContain('Amplify');
});

test('internal tenant paths are not reachable as duplicate URLs', async ({ request }) => {
  expect((await hostGet(request, 'amplify.localhost:3100', '/amplify/courses')).status()).toBe(404);
});
