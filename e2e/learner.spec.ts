import { expect, test } from '@playwright/test';
import { resetData, signIn, tenantUrl } from './helpers';

test.beforeEach(async () => {
  await resetData();
});

test('buy a course by card and start learning', async ({ page }) => {
  await signIn(page, 'amplify', '/checkout?course=client-acquisition-sprint');
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await expect(page.getByLabel('Full name')).toHaveValue('Jordan Tate');

  // Totals come from the API: applying a coupon changes the charge.
  await page.getByLabel('Coupon code').fill('LAUNCH20');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('20% discount applied')).toBeVisible();

  // No card fields on our page: the fake gateway's stand-in for Stripe's Payment Element picks a test card.
  await expect(page.getByLabel('Card number')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Test card' })).toBeVisible();
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.locator('form button[type=submit]', { hasText: 'Pay $' }).click();

  await expect(page.getByRole('heading', { name: 'You’re enrolled!' })).toBeVisible();
  await page.getByRole('link', { name: 'Start lesson 1 →' }).click();
  await expect(page.getByText('You’re enrolled! Receipt sent to your email.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Sprint kickoff' })).toBeVisible();
});

test('declined cards show an inline error and charge nothing', async ({ page }) => {
  await signIn(page, 'amplify', '/checkout?course=podcast-launchpad');
  await page.getByLabel(/declined/).check({ force: true });
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.locator('form button[type=submit]', { hasText: 'Pay $' }).click();
  await expect(page.locator('.alert-bad')).toContainText('declined');
  await expect(page).toHaveURL(/\/checkout/);
});

test('complete a lesson and pass a quiz in the player', async ({ page }) => {
  await signIn(page);
  await page.goto('/learn/email-marketing-mastery/les_e_1_1');
  await page.getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByRole('button', { name: '✓ Completed' })).toBeVisible();

  await page.getByRole('link', { name: /Sequence check/ }).click();
  const answers = [
    'Attract the right strangers and earn attention',
    'The outcome your student wants',
    'One step converts far below the others',
  ];
  for (const a of answers) await page.getByText(a, { exact: true }).click();
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page.getByText('Passed — lesson marked complete.')).toBeVisible();
});

test('dashboard reflects progress from the API', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Welcome back, Jordan' })).toBeVisible();
  await expect(page.getByText('4 of 9 lessons done')).toBeVisible();
  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  await expect(page.getByText('4 of 9 lessons done')).toHaveCount(0);
});

test('guest cart survives sign-in', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/courses/podcast-launchpad'));
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('link', { name: '✓ In cart — view cart' })).toBeVisible();
  await signIn(page, 'amplify', '/cart');
  await expect(page.getByRole('link', { name: 'Podcast Launchpad' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Client Acquisition Sprint' })).toBeVisible();
});

test('link Discord from the account page, see a failed round trip explained, and unlink', async ({ page }) => {
  await signIn(page, 'amplify', '/account');
  const card = page.getByRole('region', { name: 'Discord community' });
  await card.getByRole('link', { name: 'Link Discord' }).click();

  // Back from the round trip: the outcome shows once and the query string is stripped.
  await expect(page.getByRole('status').filter({ hasText: 'Discord linked.' })).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
  await expect(card.getByText('Linked as jordan.tate')).toBeVisible();

  await card.getByRole('button', { name: 'Unlink' }).click();
  await expect(page.getByText('Discord unlinked — the roles from your courses will be removed')).toBeVisible();
  await expect(card.getByRole('link', { name: 'Link Discord' })).toBeVisible();

  await page.goto(tenantUrl('amplify', '/api/v1/me/discord/link?next=%2Faccount&mock_reason=already_linked'));
  await expect(page.getByRole('alert').filter({ hasText: 'already linked to another learner' })).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
});
