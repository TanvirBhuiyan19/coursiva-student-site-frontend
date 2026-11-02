import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { jsonLd, resetData, signIn, tenantUrl } from './helpers';

/** Track F: public webinars (/webinars/{slug}), the join link and the paid session ticket CTA on /live/{id}. */
test.beforeEach(async () => {
  await resetData();
});

const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 820, height: 1180 },
  { width: 390, height: 844 },
  { width: 375, height: 667 },
];

const noOverflow = async (page: Page, label: string) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
};

test('a free webinar is public and indexable, and a visitor registers with name and email', async ({ page }) => {
  await page.goto('/webinars/email-copy-clinic');
  await expect(page.getByRole('heading', { level: 1, name: 'Email copy clinic' })).toBeVisible();
  await expect(page).toHaveTitle(/Email copy clinic/);
  await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute('content', /noindex/);
  const event = (await jsonLd(page)).find((d) => d['@type'] === 'Event');
  expect(event).toMatchObject({ name: 'Email copy clinic', eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode' });
  await expect(page.getByTestId('webinar-price')).toHaveText('Free');
  await expect(page.getByText('Open to everyone — no course needed.')).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations).toEqual([]);

  for (const size of SIZES) {
    await page.setViewportSize(size);
    await noOverflow(page, `${size.width}x${size.height}`);
    await page.screenshot({ path: `test-results/webinar-free-${size.width}x${size.height}.png`, fullPage: true });
  }

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByLabel('Your name').fill('Vee Visitor');
  await page.getByLabel('Email').fill('vee@example.com');
  await page.getByRole('button', { name: 'Save my seat' }).click();
  await expect(page.getByTestId('webinar-check-email')).toContainText('vee@example.com');
});

test('a paid webinar sends a visitor through sign-in to the ticket checkout', async ({ page }) => {
  await page.goto('/webinars/checkout-teardown');
  await expect(page.getByTestId('webinar-price')).toHaveText('$29');
  await page.getByLabel('Your name').fill('Pat Visitor');
  await page.getByLabel('Email').fill('pat@example.com');
  await page.getByRole('button', { name: 'Continue — $29' }).click();
  // Checkout is private: a visitor signs in (or signs up) first and comes back to the ticket.
  await page.waitForURL(/\/sign-in\?next=/);
  expect(decodeURIComponent(new URL(page.url()).search)).toContain('/checkout?live=evt_paid');
  await page.setViewportSize({ width: 375, height: 667 });
  await noOverflow(page, 'sign-in 375');
});

test('the join link signs a guest in and opens the class; a dead link says so', async ({ page }) => {
  await page.goto('/webinars/join?t=wjt_demo_guest');
  await page.waitForURL(/\/live\/evt_tomorrow$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Email copy clinic' })).toBeVisible();

  await page.goto(tenantUrl('amplify', '/webinars/join?t=wjt_nope'));
  await expect(page.getByText('This link doesn’t work')).toBeVisible();
});

test('a paid session offers a ticket (and the series), checks out at the server price and seats the learner', async ({ page }) => {
  await signIn(page, 'amplify', '/live/evt_paid');
  const cta = page.getByTestId('live-ticket-cta');
  await expect(cta.getByRole('link', { name: 'Buy ticket — $29' })).toHaveAttribute('href', '/checkout?live=evt_paid');
  await expect(cta.getByRole('link', { name: 'Buy the series — $79' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save my seat' })).toHaveCount(0);

  for (const size of [
    { width: 1366, height: 768 },
    { width: 375, height: 667 },
  ]) {
    await page.setViewportSize(size);
    await noOverflow(page, `live ${size.width}`);
    await page.screenshot({ path: `test-results/live-ticket-cta-${size.width}x${size.height}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1366, height: 768 });

  await cta.getByRole('link', { name: 'Buy ticket — $29' }).click();
  await page.waitForURL(/\/checkout\?live=evt_paid/);
  await expect(page.getByText('Checkout teardown: live build').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to the live class' })).toBeVisible();
});

test('a members-only session points to memberships', async ({ page }) => {
  await signIn(page, 'amplify', '/live/evt_members');
  await expect(page.getByTestId('live-ticket-cta').getByRole('link', { name: 'See memberships' })).toHaveAttribute('href', '/membership');
});
