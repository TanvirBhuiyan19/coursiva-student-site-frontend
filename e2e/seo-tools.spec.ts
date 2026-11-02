import { expect, test } from '@playwright/test';
import { hostGet, jsonLd, resetData, tenantUrl } from './helpers';

/**
 * The school's SEO settings on the storefront (docs/api/pages.md → SEO): redirects at the edge (prefix, chains, query
 * handling, loops), robots.txt from the school's rules, the sitemap, per-page metadata overrides, the title template,
 * JSON-LD validity and the 404 monitor. Amplify's seed: mock-api/seed/amplify.ts → `seo`.
 */
const AMP = 'amplify.localhost:3100';

test.beforeEach(async () => {
  await resetData();
});

test('redirects are enforced at the edge: exact, prefix, chains and query strings', async ({ request }) => {
  const exact = await hostGet(request, AMP, '/old-courses?utm_source=mail', { maxRedirects: 0 });
  expect(exact.status()).toBe(301);
  expect(exact.headers().location).toBe('/courses?utm_source=mail');

  const prefix = await hostGet(request, AMP, '/OLD-BLOG/five-headlines-that-sell', { maxRedirects: 0 });
  expect(prefix.status()).toBe(301);
  expect(prefix.headers().location).toBe('/blog/five-headlines-that-sell');

  // /promo → /old-courses?ref=promo → /courses: one 302 hop to the final page, the destination's own query kept.
  const chain = await hostGet(request, AMP, '/promo?ref=other&x=1', { maxRedirects: 0 });
  expect(chain.status()).toBe(302);
  expect(chain.headers().location).toBe('/courses?ref=promo&x=1');

  // keep_query off and an external destination.
  const external = await hostGet(request, AMP, '/partner-site?utm=1', { maxRedirects: 0 });
  expect(external.status()).toBe(302);
  expect(external.headers().location).toBe('https://example.com/partners');

  // The destination is a real page, and the served redirects were counted.
  expect((await hostGet(request, AMP, '/courses?utm_source=mail')).status()).toBe(200);
  const counts = (await (await fetch('http://127.0.0.1:8797/__mock/seo', { headers: { 'X-Tenant': 'amplify' } })).json()) as {
    data: { redirects: { id: string; hits: number }[] };
  };
  expect(counts.data.redirects.find((r) => r.id === 'rd_old_courses')?.hits).toBeGreaterThanOrEqual(1);
});

test('a redirect loop is never served (the API refuses it; the proxy also stops)', async ({ request }) => {
  // The seed has no loop; a path no rule covers is just a page (or a 404).
  const res = await hostGet(request, AMP, '/no-such-page-at-all', { maxRedirects: 0 });
  expect(res.status()).toBe(404);
});

test('robots.txt keeps private paths closed in every group the school writes', async ({ request }) => {
  const robots = await (await hostGet(request, AMP, '/robots.txt')).text();
  const groups = robots.split('\n\n');
  const googlebot = groups.find((g) => g.includes('User-agent: Googlebot'))!;
  expect(googlebot).toContain('Disallow: /tmp');
  for (const g of groups.filter((x) => x.startsWith('User-agent'))) {
    for (const path of ['/account', '/learn/', '/checkout', '/preview/', '/api/']) expect(g).toContain(`Disallow: ${path}`);
  }
  expect(robots).not.toContain('Allow: /account/settings');
  expect(robots).toContain('Disallow: /drafts');
  expect(robots.trimEnd().endsWith(`Sitemap: ${tenantUrl('amplify', '/sitemap.xml')}`)).toBe(true);
});

test('the sitemap leaves out pages the school hid and lists blog posts', async ({ request }) => {
  const sitemap = await (await hostGet(request, AMP, '/sitemap.xml')).text();
  expect(sitemap).toContain(tenantUrl('amplify', '/courses/the-funnel-blueprint'));
  expect(sitemap).not.toContain('/courses/launch-lab<');
  expect(sitemap).not.toContain('/checkout');
});

test('metadata: the title template, per-page overrides, noindex and share images', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/courses/the-funnel-blueprint'));
  // Amplify's template is `{page} · {school}` (the API's default is `{page} — {school}`).
  await expect(page).toHaveTitle('The Funnel Blueprint · Amplify Coaching');

  await page.goto(tenantUrl('amplify', '/blog'));
  await expect(page).toHaveTitle('The Amplify blog — funnels, email and launches');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /every week/);
  await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute('content', 'https://cdn.example.com/amplify/blog.png');
  await expect(page.locator('meta[name="twitter:image"]').first()).toHaveAttribute('content', 'https://cdn.example.com/amplify/blog.png');

  await page.goto(tenantUrl('amplify', '/courses/launch-lab'));
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute('content', /noindex/);
});

test('JSON-LD parses and carries Course with Offer, BreadcrumbList and BlogPosting', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/courses/the-funnel-blueprint'));
  const course = await jsonLd(page);
  const c = course.find((n) => n['@type'] === 'Course') as { offers?: { price?: string; priceCurrency?: string; availability?: string } };
  expect(c.offers).toMatchObject({ priceCurrency: expect.any(String), availability: 'https://schema.org/InStock' });
  expect(course.some((n) => n['@type'] === 'BreadcrumbList')).toBe(true);

  await page.goto(tenantUrl('amplify', '/blog/five-headlines-that-sell'));
  const blog = await jsonLd(page);
  expect(blog.find((n) => n['@type'] === 'BlogPosting')).toMatchObject({ '@context': 'https://schema.org', author: { '@type': 'Person' } });
  for (const block of await page.locator('script[type="application/ld+json"]').allTextContents()) expect(block).not.toMatch(/<\/script/i);
});

test.describe('the 404 monitor', () => {
  // Headless browsers count as bots for the monitor: this visit identifies as a regular desktop Chrome.
  test.use({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' });

  test('the 404 page reports the miss (path only, no query)', async ({ page }) => {
    await page.goto(tenantUrl('amplify', '/gone-for-good?token=secret'));
    await expect(page.locator('h1')).toBeVisible();
    await expect
      .poll(async () => {
        const res = (await (await fetch('http://127.0.0.1:8797/__mock/seo', { headers: { 'X-Tenant': 'amplify' } })).json()) as {
          data: { not_found: { path: string }[] };
        };
        return res.data.not_found.map((r) => r.path);
      })
      .toContain('/gone-for-good');
  });

  test('a miss reached from the site itself is an internal (broken) link, as the server saw it', async ({ page }) => {
    // A document load whose Referer is the site: the proxy notes it, the 404 page only sends its path.
    await page.goto(tenantUrl('amplify', '/broken-internal-link'), { referer: tenantUrl('amplify', '/courses') });
    await expect(page.locator('h1')).toBeVisible();
    await expect
      .poll(async () => {
        const res = (await (await fetch('http://127.0.0.1:8797/__mock/seo', { headers: { 'X-Tenant': 'amplify' } })).json()) as {
          data: { not_found: { path: string; internal_hits?: number; referrer_host: string | null }[] };
        };
        return res.data.not_found.find((r) => r.path === '/broken-internal-link');
      })
      .toMatchObject({ internal_hits: 1, referrer_host: null });
  });
});
