import AxeBuilder from '@axe-core/playwright';
import { type Browser, type Page, expect, test } from '@playwright/test';
import { resetData, signIn, tenantUrl } from './helpers';

/**
 * Service products and 1:1 bookings (docs/api/commerce.md → Service products, docs/api/account.md → Bookings): pick a
 * time, pay, see the session; a second learner can't take a held time; times follow the chosen zone.
 */

test.beforeEach(async () => {
  await resetData();
});

const PRODUCT = '/products/strategy-call';
const GOAL = 'What would you like to get out of the call?';

const slots = (page: Page) => page.getByRole('group', { name: /^Open times on/ }).getByRole('button');

async function signInAs(page: Page, email: string, next: string) {
  await page.goto(tenantUrl('amplify', `/sign-in?next=${encodeURIComponent(next)}`));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname === next);
}

async function learner(browser: Browser, email: string) {
  const context = await browser.newContext({ timezoneId: 'America/Chicago' });
  const page = await context.newPage();
  await signInAs(page, email, PRODUCT);
  return { context, page };
}

test('pick a time, pay for it and find it under Your bookings', async ({ page }) => {
  await signIn(page, 'amplify', PRODUCT);
  const first = slots(page).first();
  await expect(first).toBeVisible();
  const time = (await first.textContent()) ?? '';
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel(GOAL).fill('Plan my spring launch');
  await page.getByRole('button', { name: /^Book and pay/ }).click();

  await page.waitForURL((u) => u.pathname === '/checkout' && u.searchParams.get('product') === 'strategy-call');
  await expect(page.getByText('Slot held for 15 min')).toBeVisible();
  await expect(page.getByText(/Pay within \d+:\d\d to keep this time/)).toBeVisible();
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.locator('form button[type=submit]', { hasText: 'Pay' }).click();

  await expect(page.getByRole('heading', { name: 'Your session is booked!' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: 'Go to my bookings →' }).click();
  await page.waitForURL((u) => u.pathname === '/account/bookings');
  const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Strategy call' }) });
  await expect(row).toContainText('Booked');
  await expect(row).toContainText(time);

  // The session page: the time, the policy, calendar and changes.
  await row.getByRole('link', { name: 'Strategy call' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Strategy call' })).toBeVisible();
  // The earliest time is often inside the 24-hour notice window: the page then says it can't be changed.
  await expect(page.getByText(/(up to|less than) 24 hours/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add to calendar' })).toHaveAttribute(
    'href',
    /\/api\/v1\/me\/bookings\/bk_[^/]+\/calendar\.ics$/,
  );
  await expect(page.getByText('Plan my spring launch')).toBeVisible();
});

test('a time another learner is holding can’t be booked twice', async ({ browser }) => {
  const jordan = await learner(browser, 'jordan.tate@gmail.com');
  const priya = await learner(browser, 'priya.nair@example.com');
  // Both see the same open times.
  const theirs = slots(priya.page).first();
  await expect(theirs).toBeVisible();
  const mine = slots(jordan.page).first();
  await expect(mine).toHaveText((await theirs.textContent()) ?? '');

  await mine.click();
  await jordan.page.getByLabel(GOAL).fill('Pricing');
  await jordan.page.getByRole('button', { name: /^Book and pay/ }).click();
  await jordan.page.waitForURL((u) => u.pathname === '/checkout');

  // Priya's page still shows the time; booking it is refused and the open times reload without it.
  const time = (await theirs.textContent()) ?? '';
  await theirs.click();
  await priya.page.getByLabel(GOAL).fill('Pricing');
  await priya.page.getByRole('button', { name: /^Book and pay/ }).click();
  await expect(priya.page.getByText('That time was just taken. Pick another time.')).toBeVisible();
  await expect(slots(priya.page).first()).not.toHaveText(time);
  expect(priya.page.url()).toContain(PRODUCT);

  await jordan.context.close();
  await priya.context.close();
});

test.describe('time zones', () => {
  test.use({ timezoneId: 'Asia/Tokyo' });

  const label = (iso: string, timeZone: string) =>
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));

  test('detects the learner’s zone and shows the times in the zone they choose', async ({ page }) => {
    const tokyo = page.waitForResponse((r) => r.url().includes('/availability') && r.url().includes('timezone=Asia%2FTokyo'));
    await page.goto(tenantUrl('amplify', PRODUCT));
    const first = ((await (await tokyo).json()) as { data: { days: { slots: { starts_at: string }[] }[] } }).data.days[0]!.slots[0]!
      .starts_at;
    await expect(page.getByLabel('Time zone')).toHaveValue('Asia/Tokyo');
    await expect(slots(page).first()).toHaveText(label(first, 'Asia/Tokyo'));

    const london = page.waitForResponse((r) => r.url().includes('/availability') && r.url().includes('timezone=Europe%2FLondon'));
    await page.getByLabel('Time zone').selectOption('Europe/London');
    const firstLondon = ((await (await london).json()) as { data: { days: { slots: { starts_at: string }[] }[] } }).data.days[0]!.slots[0]!
      .starts_at;
    await expect(slots(page).first()).toHaveText(label(firstLondon, 'Europe/London'));
  });
});

test('a guest signs in to book and comes back to the time they picked', async ({ page }) => {
  await page.goto(tenantUrl('amplify', PRODUCT));
  const first = slots(page).first();
  await first.click();
  const time = (await first.textContent()) ?? '';
  await page.getByLabel(GOAL).fill('Grow my list');
  await page.getByRole('button', { name: /^Sign in to book/ }).click();
  await page.waitForURL((u) => u.pathname === '/sign-in');
  await page.getByLabel('Email').fill('jordan.tate@gmail.com');
  await page.getByLabel('Password', { exact: true }).fill('password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname === PRODUCT && u.searchParams.has('slot'));
  await expect(slots(page).filter({ hasText: time }).first()).toHaveAttribute('aria-pressed', 'true');
});

test('booking pages pass axe', async ({ page }) => {
  const audit = async (path: string) => {
    await page.goto(tenantUrl('amplify', path));
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 15_000 });
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      path,
    ).toEqual([]);
  };
  await signIn(page, 'amplify', PRODUCT);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const p of [PRODUCT, '/account/bookings', '/account/bookings/bk_demo_next']) await audit(p);
  }
});
