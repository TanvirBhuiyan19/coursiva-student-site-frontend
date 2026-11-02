import { expect, test } from '@playwright/test';
import { hostGet, jsonLd, resetData, tenantUrl } from './helpers';

/** Public instructor profiles (docs/api/instructors.md): index, profile, course links, former slugs, sitemap. */
test.beforeEach(resetData);

test('the index lists published profiles only, with collection data', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/instructors'));
  await expect(page.getByRole('heading', { level: 1, name: 'Our instructors' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Maya Reyes' })).toHaveAttribute('href', '/instructors/maya-reyes');
  await expect(page.getByRole('link', { name: 'Priya Shah' })).toBeVisible();
  await expect(page.getByText('Leo Park')).toHaveCount(0); // a draft profile
  expect((await jsonLd(page)).some((d) => d['@type'] === 'CollectionPage')).toBe(true);

  await page.goto(tenantUrl('northwind', '/instructors'));
  await expect(page.getByText('No instructor profiles yet — check back soon.')).toBeVisible();
});

test('a profile is server-rendered with ProfilePage data, canonical URL and profile Open Graph', async ({ page, request }) => {
  const html = await (await hostGet(request, 'amplify.localhost:3100', '/instructors/maya-reyes')).text();
  expect(html).toContain('Funnel strategist');
  await page.goto(tenantUrl('amplify', '/instructors/maya-reyes'));
  await expect(page.getByRole('heading', { level: 1, name: 'Maya Reyes' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Maya Reyes on LinkedIn' })).toHaveAttribute('href', 'https://www.linkedin.com/in/mayareyes');
  await expect(page.getByRole('heading', { name: 'How I teach' })).toBeVisible(); // the API's bio HTML
  await expect(page.getByRole('region', { name: 'Courses by Maya Reyes' }).getByRole('article').first()).toBeVisible();
  await expect(page).toHaveTitle(/Maya Reyes — funnel strategist and course creator/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', tenantUrl('amplify', '/instructors/maya-reyes'));
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'profile');
  const profile = (await jsonLd(page)).find((d) => d['@type'] === 'ProfilePage') as { mainEntity: { sameAs: string[] } } | undefined;
  expect(profile?.mainEntity.sameAs).toContain('https://mayareyes.example.com');
});

test('course pages link the instructor to a visible profile only', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/courses/the-funnel-blueprint'));
  await page.getByRole('link', { name: 'View Maya Reyes’s profile' }).click();
  await expect(page).toHaveURL(tenantUrl('amplify', '/instructors/maya-reyes'));
  await page.goto(tenantUrl('amplify', '/courses/launch-lab'));
  await expect(page.getByRole('heading', { name: 'Leo Park' })).toBeVisible();
  await expect(page.getByRole('link', { name: /View .* profile/ })).toHaveCount(0);
});

test('a former slug redirects permanently; unknown profiles are 404', async ({ request }) => {
  const old = await hostGet(request, 'amplify.localhost:3100', '/instructors/maya', { maxRedirects: 0 });
  expect([301, 308]).toContain(old.status());
  expect(old.headers().location).toMatch(/\/instructors\/maya-reyes$/);
  expect((await hostGet(request, 'amplify.localhost:3100', '/instructors/leo-park')).status()).toBe(404);
  expect((await hostGet(request, 'amplify.localhost:3100', '/instructors/nobody')).status()).toBe(404);
});

test('the sitemap lists the index and every visible profile', async ({ request }) => {
  const sitemap = await (await hostGet(request, 'amplify.localhost:3100', '/sitemap.xml')).text();
  expect(sitemap).toContain(tenantUrl('amplify', '/instructors<'));
  expect(sitemap).toContain(tenantUrl('amplify', '/instructors/maya-reyes'));
  expect(sitemap).not.toContain('/instructors/leo-park');
  const northwind = await (await hostGet(request, 'northwind.localhost:3100', '/sitemap.xml')).text();
  expect(northwind).not.toContain('/instructors');
});
