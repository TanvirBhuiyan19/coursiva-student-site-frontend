import { expect, test, type Page } from '@playwright/test';
import { resetData, tenantUrl } from './helpers';

/**
 * Affiliate link → purchase (docs/consent.md → The partner link, docs/api/commerce.md → ref, ref_click). Northwind asks
 * for cookie consent first and runs a fixed-amount program (first click, no expiry, renewals while subscribed); `maya`
 * is the mock's Active partner.
 */

test.beforeEach(async () => {
  await resetData();
});

const isClick = (url: string, method: string) => url.endsWith('/api/v1/affiliates/maya/clicks') && method === 'POST';

async function buyYogaFoundations(page: Page, email: string) {
  await page.goto(tenantUrl('northwind', `/sign-up?next=${encodeURIComponent('/checkout?course=yoga-foundations')}`));
  await page.getByLabel('Full name').fill('Nia Park');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('password-123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await page.getByLabel('Billing country').selectOption('Australia');
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  const checkout = page.waitForRequest((r) => r.url().endsWith('/api/v1/checkout') && r.method() === 'POST');
  await page.locator('form button[type=submit]', { hasText: 'Pay £89' }).click();
  const body = (await checkout).postDataJSON() as Record<string, unknown>;
  await expect(page.getByRole('heading', { name: 'You’re enrolled!' })).toBeVisible({ timeout: 15_000 });
  return body;
}

test('accepting marketing keeps the recorded click, and the purchase carries ref + its click id', async ({ page }) => {
  await page.goto(tenantUrl('northwind', '/?ref=maya'));
  const clicked = page.waitForResponse((r) => isClick(r.url(), r.request().method()));
  await page.getByRole('region', { name: 'Cookie notice' }).getByRole('button', { name: 'Accept' }).click();
  const click = await clicked;
  expect(click.status()).toBe(201);
  const { data } = (await click.json()) as { data: { click_id: string; cookie_days: number; attribution: string } };
  expect(data).toMatchObject({ cookie_days: 0, attribution: 'first_click' });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('coursiva:ref'))).toContain(`"click":"${data.click_id}"`);

  const body = await buyYogaFoundations(page, 'nia.partner@example.com');
  expect(body).toMatchObject({ ref: 'maya', ref_click: data.click_id });
});

test('declining marketing reports no click and the purchase sends neither ref nor ref_click', async ({ page }) => {
  const clicks: string[] = [];
  page.on('request', (r) => {
    if (isClick(r.url(), r.method())) clicks.push(r.url());
  });
  await page.goto(tenantUrl('northwind', '/?ref=maya'));
  await page.getByRole('region', { name: 'Cookie notice' }).getByRole('button', { name: 'Decline' }).click();
  expect(await page.evaluate(() => localStorage.getItem('coursiva:ref'))).toBeNull();

  const body = await buyYogaFoundations(page, 'nia.declined@example.com');
  expect(body).not.toHaveProperty('ref');
  expect(body).not.toHaveProperty('ref_click');
  expect(clicks).toEqual([]);
});

test('the partner page shows a fixed amount, the no-expiry window and renewals while subscribed', async ({ page }) => {
  await page.goto(tenantUrl('northwind', '/partners'));
  await expect(page.getByText('Recommend Northwind Yoga and earn £15 on every sale you send our way.')).toBeVisible();
  await expect(page.getByText('£15 per sale')).toBeVisible();
  await expect(page.getByText('Any time after the click — referrals don’t expire')).toBeVisible();
  await expect(page.getByText('You earn on every renewal for as long as they stay subscribed')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Earn more as you grow' })).toHaveCount(0);

  await page.goto(tenantUrl('amplify', '/partners'));
  await expect(page.getByText('20% per sale').first()).toBeVisible();
  await expect(page.getByText('30 days after the click')).toBeVisible();
  await expect(page.getByText('You earn on the first payment')).toBeVisible();
});
