import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { resetData, signIn, tenantUrl } from './helpers';

/** Tier-1 learner flows: community replies, reports and held posts; the dashboard's live banner; expired sessions. */
test.beforeEach(async () => {
  await resetData();
});

test('read and write replies, report a post and see a held post as awaiting approval', async ({ page }) => {
  await signIn(page, 'amplify', '/community');
  const post = page.getByRole('article').filter({ hasText: 'Huge congrats to everyone who finished Module 3' });
  const toggle = post.getByRole('button', { name: '12 replies' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const thread = post.getByRole('region', { name: /^Replies to / });
  await expect(thread.getByRole('listitem')).toHaveCount(12);

  await thread.getByLabel(/^Write a reply to /).fill('Thanks for the review, Maya!');
  await thread.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(thread.getByText('Thanks for the review, Maya!')).toBeVisible();
  await expect(post.getByRole('button', { name: '13 replies' })).toBeVisible();

  // Report: a modal that needs a reason.
  await post.getByRole('button', { name: 'Report' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report this post' });
  await expect(dialog).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('dialog[open]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Choose why you’re reporting this post.');
  await dialog.getByText('Spam or self-promotion').click();
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Thanks. The moderators will review this post.')).toBeVisible();
  await expect(post.getByRole('button', { name: 'Reported' })).toBeDisabled();

  // A link from a new member waits for a moderator: "Awaiting approval", never "Posted".
  await page.getByRole('textbox', { name: /^Write a post in / }).fill('My landing page is live: https://example.com/launch');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.locator('#main').getByRole('status').filter({ hasText: 'Awaiting approval' })).toBeVisible();
  await expect(page.getByText(/^Posted in /)).toHaveCount(0);
  await expect(page.getByText('My landing page is live: https://example.com/launch')).toHaveCount(0);
});

test('guests read replies and are asked to sign in to reply', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/community'));
  const post = page.getByRole('article').filter({ hasText: 'Huge congrats to everyone who finished Module 3' });
  await post.getByRole('button', { name: '12 replies' }).click();
  await expect(post.getByRole('region', { name: /^Replies to / }).getByRole('listitem')).toHaveCount(12);
  await expect(post.getByRole('link', { name: 'Sign in to reply' })).toHaveAttribute('href', /\/sign-in\?next=%2Fcommunity/);
  await expect(post.getByRole('button', { name: 'Report' })).toHaveCount(0);
});

test('the dashboard shows the next live class with RSVP', async ({ page }) => {
  await signIn(page);
  const banner = page.getByRole('region', { name: 'Next live session' });
  await expect(banner).toBeVisible();
  const rsvp = banner.getByRole('button', { name: /attending/ });
  const pressed = await rsvp.getAttribute('aria-pressed');
  await rsvp.click();
  await expect(rsvp).toHaveAttribute('aria-pressed', pressed === 'true' ? 'false' : 'true');
});

test('an expired session goes to sign-in with a message and comes back to the page', async ({ page, context }) => {
  await signIn(page, 'amplify', '/account');
  // Leave the signed-in page first: its own background reads would otherwise hit the 401 and send it to sign-in.
  await page.goto('about:blank');
  // The cookie is still there (so the proxy lets the page render) but the API no longer knows the session.
  const cookies = await context.cookies();
  await context.addCookies(cookies.filter((c) => c.name === 'coursiva_session').map((c) => ({ ...c, value: 'expired-session' })));
  // The page sends the learner on as soon as the API answers 401, which can cut the navigation short.
  await page.goto(tenantUrl('amplify', '/account/billing')).catch(() => undefined);
  await page.waitForURL((u) => u.pathname === '/sign-in' && u.searchParams.get('reason') === 'session_expired');
  expect(new URL(page.url()).searchParams.get('next')).toBe('/account/billing');
  await expect(page.getByRole('status').filter({ hasText: 'Your session expired' })).toBeVisible();
  await expect(page.getByText('Something went wrong')).toHaveCount(0);

  await page.getByLabel('Email').fill('jordan.tate@gmail.com');
  await page.getByLabel('Password', { exact: true }).fill('password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/account/billing');
});
