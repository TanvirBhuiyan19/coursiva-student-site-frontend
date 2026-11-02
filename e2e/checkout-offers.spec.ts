import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetData, tenantUrl } from './helpers';

/**
 * Checkout offers end to end on the mock (docs/api/commerce.md → Offers, Post-purchase offers). Amplify's offers are
 * all on Brand Storytelling Lab ($179): a 15% countdown sale, team tiers, Pricing with Confidence 30% off as
 * "frequently bought together", then Launch Lab 20% off (upsell) and Podcast Launchpad 50% off (downsell) on the
 * thank-you page. A new learner buys it (the seed's Jordan already owns it). Every figure is the API's.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeEach(async () => {
  await resetData();
});

/** `include`: audit only that part (the confirmation page's footer link is a known, separate finding). */
async function axe(page: Page, label: string, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  const { violations } = await (include ? builder.include(include) : builder).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    label,
  ).toEqual([]);
}

async function signUpToCheckout(page: Page, email: string) {
  await page.goto(tenantUrl('amplify', `/sign-up?next=${encodeURIComponent('/checkout?course=brand-storytelling-lab')}`));
  await page.getByLabel('Full name').fill('Lena Learner');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('password-123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
}

test('sale, cross-sell, then the thank-you upsell: decline it, take the downsell with one click', async ({ page }) => {
  await signUpToCheckout(page, 'lena.offers@example.com');

  const banner = page.getByRole('region', { name: 'Offer' });
  await expect(banner.getByText('Spring sale — 15% off Brand Storytelling Lab')).toBeVisible();
  await expect(banner.getByRole('timer')).toHaveText(/^1d \d\d:\d\d:\d\d$/);
  const summary = page.getByRole('complementary');
  await expect(summary.getByText('Was $179')).toBeAttached();
  await expect(summary.getByText('You save $26.85')).toBeVisible();
  await expect(page.getByText('3+ seats: 10% off')).toBeVisible();
  await expect(page.getByText(/only charged if you accept/)).toBeVisible();

  // Frequently bought together: the API adds it as a line at the offer price.
  const together = page.getByRole('region', { name: 'Frequently bought together' });
  await together.getByRole('checkbox', { name: 'Add this course for $69.30 (30% off)' }).check();
  await expect(summary.getByText('You save $56.55')).toBeVisible();
  await axe(page, 'checkout with offers');
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.locator('form button[type=submit]', { hasText: 'Pay $221.45' }).click();
  await expect(page.getByRole('heading', { name: 'You’re enrolled!' })).toBeVisible({ timeout: 15_000 });

  // The one-click upsell, charged to the card just used only if accepted.
  const upsell = page.getByRole('region', { name: 'Add Launch Lab for 20% off' });
  await expect(upsell.getByText('One click charges your Visa ending in 4242 — the card you just used.', { exact: false })).toBeVisible();
  await expect(upsell.getByRole('timer')).toHaveText(/^(29|30):\d\d$/);
  await expect(upsell.getByRole('button', { name: 'Add to my order — $119.20' })).toBeVisible();
  await axe(page, 'thank-you upsell', 'section[aria-labelledby^="offer-"]');
  await upsell.getByRole('button', { name: 'No thanks' }).click();

  const downsell = page.getByRole('heading', { name: 'How about Podcast Launchpad instead?' });
  await expect(downsell).toBeFocused();
  await page.getByRole('button', { name: 'Add to my order — $64.50' }).click();
  await expect(page.getByText('Podcast Launchpad is added to your order.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Add to my order/ })).toHaveCount(0);

  // Enrolled in all three; the receipt for the one-click order is in the history.
  await page.goto(tenantUrl('amplify', '/account/orders'));
  await expect(page.getByText('Podcast Launchpad', { exact: true }).first()).toBeVisible();
});

test('a 3-D Secure card: the one-click charge runs the bank’s challenge, then the order is paid', async ({ page }) => {
  await signUpToCheckout(page, 'max.offers@example.com');
  await page.getByLabel(/3-D Secure/).check({ force: true });
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.locator('form button[type=submit]', { hasText: 'Pay $152.15' }).click();
  await expect(page.getByRole('heading', { name: 'You’re enrolled!' })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Add to my order — $119.20' }).click();
  await expect(page.getByText('Launch Lab is added to your order.')).toBeVisible({ timeout: 15_000 });
  await page.goto(tenantUrl('amplify', '/learning'));
  await expect(page.getByText('Launch Lab').first()).toBeVisible();
});
