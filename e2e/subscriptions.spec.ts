import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetData, signIn } from './helpers';

/**
 * Cancelling a membership online (docs/api/account.md → Subscriptions): join at checkout, then from the billing page
 * the optional exit survey, the school's save offers, and a single confirmation; access lasts until the end of the paid
 * period and the cancellation can be undone until then.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

test.beforeEach(async () => {
  await resetData();
});

async function axe(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    label,
  ).toEqual([]);
}

/** Jordan joins Pro monthly at checkout, then opens the billing page. */
async function joinPro(page: Page) {
  await signIn(page, 'amplify', '/checkout?plan=plan_pro&interval=month');
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.locator('form button[type=submit]', { hasText: /^Pay|Start/ }).click();
  await page.waitForURL((u) => u.pathname.startsWith('/checkout/success/'), { timeout: 15_000 });
  await page.goto('/account/billing');
  return page.getByRole('region', { name: 'Subscriptions' });
}

test('a member takes a save offer instead of cancelling', async ({ page }) => {
  const subs = await joinPro(page);
  await expect(subs.getByText('Pro membership')).toBeVisible();
  await subs.getByRole('button', { name: 'Cancel Pro' }).click();

  const dialog = page.getByRole('dialog', { name: 'Cancel Pro' });
  await dialog.getByRole('radio', { name: 'It’s too expensive' }).check();
  await axe(page, 'cancel flow survey');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByText('Before you go')).toBeVisible();
  await expect(dialog.getByText('Switch to Starter')).toBeVisible();
  await axe(page, 'cancel flow offers');
  await dialog.getByRole('button', { name: 'Take the offer: Stay for 30% off' }).click();

  await expect(dialog).toBeHidden();
  await expect(subs.getByText('30% off the next 3 renewals')).toBeVisible();
  await expect(subs.getByText('Active')).toBeVisible();
});

test('a member cancels in three steps, keeps access to the period end, and undoes it', async ({ page }) => {
  const subs = await joinPro(page);
  await subs.getByRole('button', { name: 'Cancel Pro' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel Pro' });
  // The survey is optional, and every offer can be declined.
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'No thanks, continue to cancel' }).click();
  await expect(dialog.getByText(/You won’t be charged again\. Your access lasts until/)).toBeVisible();
  await axe(page, 'cancel confirmation');
  await dialog.getByRole('button', { name: 'Cancel subscription' }).click();

  await expect(dialog).toBeHidden();
  await expect(subs.getByText(/Cancelled · your access lasts until/)).toBeVisible();
  await expect(subs.getByRole('button', { name: 'Cancel Pro' })).toHaveCount(0);

  await subs.getByRole('button', { name: 'Keep Pro' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your subscription is active again.' })).toBeVisible();
  await expect(subs.getByText(/renews/)).toBeVisible();
});

test('a member pauses instead, then resumes', async ({ page }) => {
  const subs = await joinPro(page);
  await subs.getByRole('button', { name: 'Cancel Pro' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel Pro' });
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Take the offer: Pause instead' }).click();
  await expect(subs.getByText(/Billing paused · resumes/)).toBeVisible();
  await subs.getByRole('button', { name: 'Resume Pro' }).click();
  await expect(subs.getByText(/renews/)).toBeVisible();
});
