import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { hostGet, resetData, signIn } from './helpers';

/** Live classes v2, learner side: the /live schedule, the calendar feed, the countdown and replays on /live/{id}. */
test.beforeEach(async () => {
  await resetData();
});

const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 820, height: 1180 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
];

test('the schedule lists sessions by day with RSVP, join and replays, and fits every screen', async ({ page }) => {
  await signIn(page, 'amplify', '/live');
  await expect(page.getByRole('heading', { level: 1, name: 'Live classes' })).toBeVisible();
  await expect(page.getByTestId('live-timezone')).toContainText('Times in');

  const live = page.getByRole('article', { name: 'Office hours with Maya' });
  await expect(live.getByText('Live now')).toBeVisible();
  await expect(live.getByRole('link', { name: 'Join now' })).toHaveAttribute('href', '/live/evt_room/room');

  // Starting in 10 minutes: inside the join window, RSVP right on the row, then the way in.
  const soon = page.getByRole('article', { name: 'Funnel teardown: your landing pages' });
  await expect(soon.getByText('Starting soon')).toBeVisible();
  await soon.getByRole('button', { name: /^Save my seat for / }).click();
  await expect(soon.getByRole('link', { name: 'Open the room' })).toBeVisible();

  await page.getByRole('button', { name: 'My RSVPs' }).click();
  await expect(page.getByRole('article', { name: 'Funnel teardown: your landing pages' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Email copy clinic' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Replays' }).click();
  await page
    .getByRole('article', { name: 'Pricing workshop' })
    .getByRole('link', { name: /Watch replay/ })
    .click();
  await expect(page).toHaveURL(/\/live\/evt_replay$/);
  await expect(page.getByRole('heading', { name: 'Watch the replay' })).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations).toEqual([]);

  // No horizontal scroll and no inner scroll areas at the owner's device sizes.
  await page.goto('/live');
  await expect(page.getByRole('article', { name: 'Email copy clinic' })).toBeVisible();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${size.width}x${size.height}`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/live-schedule-${size.width}x${size.height}.png`, fullPage: true });
  }
});

test('subscribe a calendar: the link is shown once, a new link replaces it, and the feed lists RSVPs', async ({ page, request }) => {
  await signIn(page, 'amplify', '/live');
  const card = page.getByTestId('calendar-subscribe');
  await page
    .getByRole('article', { name: 'Email copy clinic' })
    .getByRole('button', { name: /^Save my seat for / })
    .click();
  await expect(page.getByRole('article', { name: 'Email copy clinic' }).getByText('Going')).toBeVisible();

  await card.getByRole('button', { name: 'Get my calendar link' }).click();
  const input = card.getByLabel('Or copy the subscribe link');
  await expect(input).toHaveValue(/\/api\/v1\/live\/calendar\/lcal_[A-Za-z0-9]{48}\.ics$/);
  await expect(card.getByRole('link', { name: 'Google Calendar' })).toHaveAttribute(
    'href',
    /calendar\.google\.com\/calendar\/render\?cid=webcal/,
  );
  const url = new URL(await input.inputValue());

  const feed = await hostGet(request, 'amplify.localhost:3100', url.pathname);
  expect(feed.status()).toBe(200);
  const ics = await feed.text();
  expect(ics).toContain('SUMMARY:Email copy clinic');
  expect(ics).not.toContain('Ads that convert');

  // After a reload the link isn't shown again; a new link replaces the old one.
  await page.reload();
  await expect(card.getByText('Connected')).toBeVisible();
  await expect(card.getByLabel('Or copy the subscribe link')).toHaveCount(0);
  await card.getByRole('button', { name: /Get a new link/ }).click();
  await expect(card.getByLabel('Or copy the subscribe link')).not.toHaveValue(url.href);
  expect((await hostGet(request, 'amplify.localhost:3100', url.pathname)).status()).toBe(404);
});

test('the session page counts down, explains the join window and never dead-ends after the session', async ({ page }) => {
  await signIn(page, 'amplify', '/live/evt_tomorrow');
  await expect(page.getByTestId('live-countdown')).toContainText(/Starts in 1 d|Starts in \d+ h/);
  await expect(page.getByText(/Joining opens at/)).toBeVisible();
  await page.getByRole('button', { name: 'Save my seat' }).click();
  await expect(page.getByRole('button', { name: 'Join opens 15 min before' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Add to calendar/ })).toBeVisible();

  await page.goto('/live/evt_processing');
  await expect(page.getByText('The recording is on its way')).toBeVisible();
  await expect(page.getByRole('link', { name: '← All live classes' })).toHaveAttribute('href', '/live');

  // The dashboard's upcoming widget and the header link lead to the schedule.
  await page.goto('/learning');
  const widget = page.getByTestId('upcoming-live');
  await expect(widget.getByRole('heading', { name: 'Upcoming live classes' })).toBeVisible();
  await expect(widget.getByRole('article')).toHaveCount(3);
  await widget.getByRole('link', { name: /See all/ }).click();
  await expect(page).toHaveURL(/\/live$/);
});
