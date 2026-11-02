import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { resetData, signIn, tenantUrl } from './helpers';

/** WCAG 2.2 AA via axe on every screen family, guest and signed-in, desktop and phone. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const publicPages = [
  '/',
  '/courses',
  '/courses/the-funnel-blueprint',
  '/instructors',
  '/instructors/maya-reyes',
  '/membership',
  '/products/launch-kit',
  '/products/strategy-call',
  '/help',
  '/contact',
  '/refund-policy',
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/cart',
  // Site-builder pages: every section kind, a multi-segment page and both gates.
  '/about',
  '/about/team',
  '/vip',
  '/members',
  '/privacy',
  // Phase 17: pages the school's e-mails link to.
  '/blog',
  '/blog/five-headlines-that-sell',
  '/partners',
  '/verify/AC-2026-0341',
  '/reset-password?token=reset-valid&email=jordan.tate%40gmail.com&invited=1',
  '/join/team-alpha',
  // Lead forms: the hosted page and the embed frame (every field type).
  '/forms/frm_01jd8x7k3q9w2e5r6t7y8z9abc',
  '/embed/forms/frm_01jd8x7k3q9w2e5r6t7y8z9abc',
];
/** Course builder O7: the staff preview (a lesson with blocks, a locked lesson, a quiz) and an expired link. */
const previewPages = [
  '/preview/pv_launchlab_working_day0_demo_000000000000?lesson=les_l_draft_0',
  '/preview/pv_launchlab_working_day0_demo_000000000000?lesson=les_l_2_5',
  '/preview/pv_launchlab_published_day15_demo_00000000?lesson=les_l_0_2',
  '/preview/pv_launchlab_expired_demo_0000000000000000',
];
const privatePages = [
  '/learning',
  '/learn/email-marketing-mastery/les_e_1_1',
  '/learn/email-marketing-mastery/les_e_1_2',
  '/learn/launch-lab/les_l_0_0',
  '/learn/launch-lab/les_l_0_1',
  '/learn/launch-lab/les_l_0_2',
  '/learn/launch-lab/les_l_1_2',
  '/learn/launch-lab/les_l_1_3',
  '/community',
  '/certificates',
  '/account',
  '/wishlist',
  '/checkout?course=podcast-launchpad',
  '/account/billing',
  '/account/bookings',
  '/account/bookings/bk_demo_next',
  '/account?survey=sr_demo',
  '/live/evt_1',
  '/live/evt_room/room',
  '/claim?token=demo',
];

async function audit(page: Page, path: string) {
  // Site-builder entrance animations fade sections in as they scroll into view; mid-animation opacity is transient,
  // so audit the settled page (they are off under reduced motion — see sitebuilder.spec.ts).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  // Wait for data-driven content, not network silence (prefetches and polling make networkidle flaky).
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 15_000 });
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    path,
  ).toEqual([]);
}

for (const width of [1280, 390]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    // Each test sweeps many pages.
    test.describe.configure({ timeout: 120_000 });

    test('public pages', async ({ page }) => {
      for (const p of publicPages) await audit(page, tenantUrl('amplify', p));
    });

    test('locked site and preview', async ({ page }) => {
      await audit(page, tenantUrl('hideout', '/'));
      await audit(page, tenantUrl('amplify', '/?preview=preview-demo-token'));
      await audit(page, tenantUrl('northwind', '/'));
    });

    test('staff course preview', async ({ page }) => {
      for (const p of previewPages) await audit(page, tenantUrl('amplify', p));
    });

    test('learner pages', async ({ page }) => {
      await resetData();
      await signIn(page);
      for (const p of privatePages) await audit(page, tenantUrl('amplify', p));
    });
  });
}
