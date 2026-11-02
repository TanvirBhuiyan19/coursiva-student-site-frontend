import { expect, test } from '@playwright/test';
import { installDailyDouble } from './daily';
import { resetData, signIn, tenantUrl } from './helpers';

/** Phase 17 (deploy readiness): real payment flow shape, the pages the school's e-mails link to, attribution. */

test.beforeEach(async () => {
  await resetData();
});

test('3-D Secure: the bank challenge runs in the browser, then the order completes', async ({ page }) => {
  await signIn(page, 'amplify', '/checkout?course=client-acquisition-sprint');
  await page.getByLabel(/3-D Secure/).check({ force: true });
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.locator('form button[type=submit]', { hasText: 'Pay $' }).click();
  await expect(page.getByRole('heading', { name: 'You’re enrolled!' })).toBeVisible({ timeout: 15_000 });
});

test('buy a digital download from its product page, then find it under Downloads', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/products/launch-kit'));
  await expect(page.getByRole('heading', { level: 1, name: 'Launch kit' })).toBeVisible();
  await page.getByRole('link', { name: /Buy now/ }).click();
  await signIn(page, 'amplify', '/checkout?product=launch-kit');
  await expect(page.getByRole('switch', { name: 'Buy as a gift' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.locator('form button[type=submit]', { hasText: 'Pay $' }).click();
  await expect(page.getByRole('heading', { name: 'Your download is ready!' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: 'Go to my downloads →' }).click();
  await expect(page.getByText('launch-kit.zip')).toBeVisible();
});

test('a partner link is credited at checkout, and the old /checkout/{course} link still works', async ({ page }) => {
  const clicked = page.waitForResponse((r) => r.url().endsWith('/api/v1/affiliates/maya/clicks') && r.request().method() === 'POST');
  await page.goto(tenantUrl('amplify', '/?ref=maya'));
  const { data } = (await (await clicked).json()) as { data: { click_id: string } };
  await signIn(page, 'amplify', '/learning');
  await page.goto(tenantUrl('amplify', '/checkout/client-acquisition-sprint'));
  await expect(page).toHaveURL(/\/checkout\?course=client-acquisition-sprint/);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  const checkout = page.waitForRequest((r) => r.url().endsWith('/api/v1/checkout') && r.method() === 'POST');
  await page.locator('form button[type=submit]', { hasText: 'Pay $' }).click();
  expect((await checkout).postDataJSON()).toMatchObject({ ref: 'maya', ref_click: data.click_id });
  await expect(page.getByRole('heading', { name: 'You’re enrolled!' })).toBeVisible();
});

test('a free course enrols in one click — no checkout, no card', async ({ page }) => {
  await page.goto(tenantUrl('northwind', '/courses/breathwork-for-stress'));
  await page.getByRole('link', { name: 'Enrol for free' }).first().click();
  await expect(page).toHaveURL(/\/sign-up/);
  await page.getByLabel('Full name').fill('Nia Park');
  await page.getByLabel('Email').fill('nia@example.com');
  await page.getByLabel('Password', { exact: true }).fill('password-123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/courses\/breathwork-for-stress/);
  await page.getByRole('button', { name: 'Enrol for free' }).first().click();
  await expect(page).toHaveURL(/\/learn\/breathwork-for-stress\//);
});

test('reset and set a password from the e-mailed link', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/reset-password?token=reset-valid&email=jordan.tate%40gmail.com&invited=1'));
  await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible();
  await page.getByLabel('New password').fill('brand-new-pass');
  await page.getByLabel('Confirm password').fill('brand-new-pass');
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByRole('heading', { name: 'Password set' })).toBeVisible();

  await page.goto(tenantUrl('amplify', '/reset-password?token=old&email=jordan.tate%40gmail.com'));
  await page.getByLabel('New password').fill('another-pass-1');
  await page.getByLabel('Confirm password').fill('another-pass-1');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByText(/invalid or has expired/)).toBeVisible();
});

test('confirm an email from the link, or ask for a new one', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/verify-email?token=verify-valid'));
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  await page.goto(tenantUrl('amplify', '/verify-email?token=stale'));
  await expect(page.getByRole('heading', { name: 'This confirmation link has expired' })).toBeVisible();
  await expect(page.getByText(/invalid or has expired/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in to get a new link' })).toBeVisible();
});

test('a signed-in learner with an expired confirmation link sends a new one', async ({ page }) => {
  await signIn(page, 'amplify', '/learning');
  await page.goto(tenantUrl('amplify', '/verify-email?token=stale'));
  await expect(page.getByRole('heading', { name: 'This confirmation link has expired' })).toBeVisible();
  await page.getByRole('button', { name: 'Send a new confirmation link' }).click();
  await expect(page.getByText('A new confirmation link is on its way — check your inbox.')).toBeVisible();
});

test('buy a gift, then redeem its claim link', async ({ page }) => {
  await signIn(page, 'amplify', '/checkout?course=client-acquisition-sprint');
  await page.getByRole('switch', { name: 'Buy as a gift' }).click();
  await page.getByLabel('Recipient’s email').fill('friend@example.com');
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.locator('form button[type=submit]', { hasText: 'Send the gift' }).click();
  await expect(page.getByRole('heading', { name: 'Your gift is on its way!' })).toBeVisible();
  const claimUrl = new URL((await page.locator('code').first().textContent()) ?? '');
  await page.goto(tenantUrl('amplify', `${claimUrl.pathname}${claimUrl.search}`));
  await page.getByRole('button', { name: 'Add it to my account' }).click();
  await expect(page.getByRole('heading', { name: 'It’s yours!' })).toBeVisible();
});

test('the order page from the receipt e-mail', async ({ page }) => {
  await signIn(page, 'amplify', '/checkout?course=client-acquisition-sprint');
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.locator('form button[type=submit]', { hasText: 'Pay $' }).click();
  await expect(page.getByRole('heading', { name: 'You’re enrolled!' })).toBeVisible();
  const orderId = page.url().split('/').at(-1)!;
  await page.goto(tenantUrl('amplify', `/orders/${orderId}`));
  await expect(page.getByRole('heading', { name: /^Order #/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Thanks for your purchase.' })).toContainText('Paid');
});

test('verify a certificate on the school’s own site', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/verify/AC-2026-0341'));
  await expect(page.getByText('Verified certificate')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Jordan Tate' })).toBeVisible();
  const res = await page.goto(tenantUrl('amplify', '/verify/AC-2026-9999'));
  expect(res?.status()).toBe(404);
});

test('read the blog and leave a comment', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/blog'));
  await page.getByRole('link', { name: 'Five headlines that sell a course' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Five headlines that sell a course' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Why headlines matter' })).toBeVisible();
  await page.getByLabel('Name').fill('Sam');
  await page.getByLabel(/Email/).fill('sam@example.com');
  await page.getByRole('textbox', { name: 'Comment' }).fill('Great list, thanks!');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(page.getByText('Thanks! Your comment will appear once it’s approved.')).toBeVisible();
});

test('apply to the partner program', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/partners'));
  await expect(page.getByText('20% per sale').first()).toBeVisible();
  await page.getByLabel('Your name').fill('Sam Lee');
  await page.getByLabel('Email').fill('sam@example.com');
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByText('Thanks! The school reviews applications and will email you.')).toBeVisible();
});

test('answer the school’s survey from its e-mail', async ({ page }) => {
  await signIn(page, 'amplify', '/account?survey=sr_demo');
  const dialog = page.getByRole('dialog', { name: 'One quick question' });
  await expect(dialog.getByText('What should we teach next?')).toBeVisible();
  await dialog.getByText('9', { exact: true }).click();
  await dialog.getByLabel('Your answer').fill('Pricing');
  await dialog.getByRole('button', { name: 'Send answer' }).click();
  await expect(dialog.getByText('Thanks — your answer was sent to the school.')).toBeVisible();
});

test('a live session page and the built-in room', async ({ page }) => {
  await installDailyDouble(page);
  await signIn(page, 'amplify', '/live/evt_1');
  await expect(page.getByRole('heading', { name: 'Live Q&A with Maya' })).toBeVisible();
  await page.getByRole('button', { name: 'Save my seat' }).click();
  await expect(page.getByRole('link', { name: 'Join on Zoom' })).toBeVisible();

  await page.goto(tenantUrl('amplify', '/live/evt_room/room'));
  await expect(page.getByText('Live now')).toBeVisible();
  await page.getByLabel('Your question').fill('How do I price a cohort?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText('Question sent to the host')).toBeVisible();
  await page.getByRole('button', { name: 'Raise hand' }).click();
  await expect(page.getByRole('button', { name: 'Lower hand' })).toBeVisible();
});

test('billing explains when there is nothing on file', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/sign-up?next=%2Faccount%2Fbilling'));
  await page.getByLabel('Full name').fill('New Learner');
  await page.getByLabel('Email').fill('new.learner@example.com');
  await page.getByLabel('Password', { exact: true }).fill('password-123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible();
  await expect(page.getByText(/No payment details saved/)).toBeVisible();
});

test('download a purchased file from the account page', async ({ page }) => {
  await signIn(page, 'amplify', '/account');
  const section = page.getByRole('region', { name: 'Downloads' });
  await expect(section.getByText('Launch checklist')).toBeVisible();
  const download = page.waitForEvent('download');
  await section.getByRole('button', { name: 'Download Launch checklist' }).click();
  expect((await download).suggestedFilename()).toBe('launch-checklist.pdf');
  await expect(section.getByText('2 downloads left', { exact: false })).toBeVisible();
});
