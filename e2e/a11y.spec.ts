import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { resetData, signIn, tenantUrl } from './helpers';

/** WCAG 2.2 AA via axe on every screen family, guest and signed-in, desktop and phone. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const publicPages = [
  '/',
  '/courses',
  '/courses/the-funnel-blueprint',
  '/membership',
  '/help',
  '/contact',
  '/refund-policy',
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/cart',
];
const privatePages = [
  '/learning',
  '/learn/email-marketing-mastery/les_e_1_1',
  '/learn/email-marketing-mastery/les_e_1_2',
  '/community',
  '/certificates',
  '/account',
  '/wishlist',
  '/checkout?course=podcast-launchpad',
];

async function audit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    path,
  ).toEqual([]);
}

for (const width of [1280, 390]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('public pages', async ({ page }) => {
      for (const p of publicPages) await audit(page, tenantUrl('amplify', p));
    });

    test('learner pages', async ({ page }) => {
      await resetData();
      await signIn(page);
      for (const p of privatePages) await audit(page, tenantUrl('amplify', p));
    });
  });
}
