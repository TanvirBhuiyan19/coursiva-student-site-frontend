import { expect, test } from '@playwright/test';
import { hostGet, resetData, signIn, tenantUrl } from './helpers';

/**
 * What a school builds in the dashboard's site builder reaches learners: its pages and every section kind, header,
 * footer, theme, announcement, head code, legal and sign-in screens, page visibility, the site lock and previews.
 */

test.beforeEach(async () => {
  await resetData();
});

test('the home page, header, footer and site-wide settings come from the published site', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Marketing skills that grow your business' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Announcement' })).toHaveText('New: the Launch Lab cohort starts 1 November.');
  const nav = page.getByRole('navigation', { name: 'Main' }).first();
  await expect(nav.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about');
  await expect(page.getByRole('banner').getByRole('link', { name: 'Browse courses' })).toHaveAttribute('href', '/courses');
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('navigation', { name: 'Company' }).getByRole('link', { name: 'Our team' })).toHaveAttribute(
    'href',
    '/about/team',
  );
  // The school's own head code is in <head> and its script ran.
  await expect(page.locator('head meta[name="amplify-verification"]')).toHaveAttribute('content', 'amp-7f3k');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __amplifyHead?: boolean }).__amplifyHead)).toBe(true);
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute('href', /\/api\/v1\/site\/assets\/ast_favicon/);
  // Theme tokens reach <html>.
  await expect(page.locator('html')).toHaveAttribute('data-radius', 'soft');
  // The welcome video loads nothing until it's played.
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play Welcome to Amplify Coaching' }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=1');
});

test('builder pages render every section kind with anchors and per-device visibility', async ({ page, request }) => {
  const html = await (await hostGet(request, 'amplify.localhost:3100', '/about')).text();
  // Server-rendered (crawlable) and cached like any public page.
  expect(html).toContain('Teach what you practise, and practise what you teach.');
  expect(html).not.toContain('Dropped: not allow-listed');
  expect(html).not.toContain('Nowhere');

  await page.goto('/about');
  await expect(page).toHaveTitle('About Amplify Coaching · Amplify Coaching');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', tenantUrl('amplify', '/about'));
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute('content', 'Amplify Coaching');
  await expect(page.getByRole('heading', { level: 1, name: 'About Amplify Coaching' })).toBeVisible();
  for (const name of [
    'Our story',
    'Why learners stay',
    'Questions, answered',
    'In their words',
    'Pick your path',
    'Ready when you are',
    'Talk to us',
  ])
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByText('Bundle all six courses and save 30%')).toBeVisible();
  await expect(page.getByRole('table').getByRole('rowheader', { name: '1:1 calls' })).toBeVisible();
  await expect(page.locator('#story')).toHaveAttribute('data-anim', 'fade_up');
  await expect(page.getByRole('heading', { name: 'Desktop only' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mobile only' })).toBeHidden();

  // An #anchor button scrolls to the section with that anchor.
  await page.getByRole('link', { name: 'Talk to us' }).first().click();
  await expect(page).toHaveURL(/#contact$/);

  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.getByRole('heading', { name: 'Mobile only' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Desktop only' })).toBeHidden();
});

test('entrance animations run only for people who allow motion', async ({ page }) => {
  const animation = () => page.locator('#story > .container').evaluate((el) => getComputedStyle(el).animationName);
  await page.goto('/about');
  expect(await animation()).not.toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/about');
  expect(await animation()).toBe('none');
});

test('a builder form validates each field and sends', async ({ page }) => {
  await page.goto('/about#contact');
  const form = page.locator('#contact form');
  await form.getByRole('button', { name: 'Send message' }).click();
  await expect(form.getByText('This field is required.').first()).toBeVisible();
  await expect(form.getByLabel(/Your name/)).toBeFocused();
  await form.getByLabel(/Your name/).fill('Ada Lovelace');
  await form.getByLabel(/Email/).fill('ada@example.com');
  await form.getByLabel(/Topic/).selectOption('Courses');
  await form.getByLabel(/Message/).fill('Do you run workshops?');
  await form.getByLabel(/I agree to be contacted/).check();
  await form.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Thanks' })).toBeVisible();
});

test('multi-segment pages, /home and unknown pages', async ({ page, request }) => {
  await page.goto('/about/team');
  await expect(page.getByRole('heading', { name: 'The team' })).toBeVisible();
  const home = await hostGet(request, 'amplify.localhost:3100', '/home', { maxRedirects: 0 });
  expect(home.status()).toBe(308);
  expect(home.headers().location).toMatch(/^(https?:\/\/[^/]+)?\/$/);
  expect((await hostGet(request, 'amplify.localhost:3100', '/no-such-page')).status()).toBe(404);
  expect((await hostGet(request, 'amplify.localhost:3100', '/About_Us')).status()).toBe(404);
  // Built-in screens are never shadowed by the catch-all.
  await page.goto('/courses');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('password pages unlock with the page password', async ({ page }) => {
  await page.goto('/vip');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByRole('heading', { level: 1, name: 'VIP workshop' })).toBeVisible();
  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Unlock page' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'That password isn’t right.' })).toBeVisible();
  await page.getByLabel('Password').fill('open-sesame');
  await page.getByRole('button', { name: 'Unlock page' }).click();
  await expect(page.getByText('The replay and slides.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('The replay and slides.')).toBeVisible();
});

test('members-only pages ask guests to sign in and show members the page', async ({ page }) => {
  await page.goto('/members');
  await expect(page.getByRole('heading', { name: 'Members only' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' }).last()).toHaveAttribute('href', '/sign-in?next=%2Fmembers');
  await signIn(page, 'amplify', '/members');
  await expect(page.getByText('Recordings of every live Q&A.')).toBeVisible();
});

test('a preview link shows the draft on every page until the preview is closed', async ({ page }) => {
  await page.goto('/?preview=preview-demo-token');
  await expect(page).toHaveURL(tenantUrl('amplify', '/'));
  await expect(page.getByRole('heading', { level: 1, name: 'Draft: a brand-new homepage' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Preview' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Announcement' })).toContainText('Draft announcement');
  // No school head code on previews (links get shared).
  await expect(page.locator('head meta[name="amplify-verification"]')).toHaveCount(0);
  await page.goto('/about');
  await expect(page.getByRole('status').filter({ hasText: 'Preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Exit preview' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Marketing skills that grow your business' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exit preview' })).toHaveCount(0);
});

test('a locked site shows its lock screen until the visitor enters the site password', async ({ page, request }) => {
  const res = await hostGet(request, 'hideout.localhost:3100', '/');
  expect(await res.text()).not.toContain('start today and learn at your own pace');
  await page.goto(tenantUrl('hideout', '/'));
  await expect(page.getByRole('heading', { name: 'This site is private' })).toBeVisible();
  await page.getByLabel('Password').fill('nope');
  await page.getByRole('button', { name: 'Enter site' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'That password isn’t right.' })).toBeVisible();
  await page.getByLabel('Password').fill('letmein');
  await page.getByRole('button', { name: 'Enter site' }).click();
  // The starter site, built for this visitor.
  await expect(page.getByRole('heading', { level: 1, name: 'Learn with Hideout Studio' })).toBeVisible();
  await page.goto(tenantUrl('hideout', '/courses'));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This site is private' })).toHaveCount(0);
});

test('legal pages and the sign-in pitch come from their builder screens', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
  await expect(page.getByText('Last updated 1 August 2026')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What we collect' })).toBeVisible();
  await page.goto('/terms');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/sign-in');
  await expect(page.getByText('Weekly live Q&A with Maya')).toBeVisible();
  await expect(page.getByText('Marketing skills that grow your business')).toBeVisible();
});

test('the cookie banner follows the privacy setting and remembers the choice', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0); // off for Amplify
  await page.goto(tenantUrl('northwind', '/'));
  const banner = page.getByRole('region', { name: 'Cookie notice' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Accept' }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0);
});

test('pages that set their own Open Graph title keep the site share image, name and locale', async ({ page }) => {
  for (const path of ['/', '/courses', '/membership', '/about']) {
    await page.goto(path);
    await expect(page.locator('meta[property="og:site_name"]'), path).toHaveAttribute('content', 'Amplify Coaching');
    await expect(page.locator('meta[property="og:locale"]'), path).toHaveAttribute('content', 'en_US');
    await expect(page.locator('meta[property="og:image"]').first(), path).toHaveAttribute(
      'content',
      'https://cdn.coursiva.app/amplify/share.png',
    );
  }
});
