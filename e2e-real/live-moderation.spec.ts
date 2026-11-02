import { expect, test, type Browser, type Page } from '@playwright/test';
import { installDailyDouble } from '../e2e/daily';

/**
 * The live room across both surfaces on the REAL stack: the host moderates in the tenant dashboard's booth and the
 * learner's room page (student site) follows within a few seconds — no mocks, real API and database.
 *
 * Run (with the stack already up; nothing is started here):
 *   LIVE_E2E_DASHBOARD_URL=http://app.localhost:5174 \
 *   LIVE_E2E_SITE_URL=http://amplify.localhost:3000 \
 *   LIVE_E2E_SESSION=lv_… \                                  # a LIVE built-in session the learner RSVP'd to
 *   LIVE_E2E_STAFF_EMAIL=maya@amplifycoaching.com LIVE_E2E_STAFF_PASSWORD=… \
 *   LIVE_E2E_LEARNER_EMAIL=… LIVE_E2E_LEARNER_PASSWORD=… \
 *   npx playwright test -c playwright.real.config.ts
 *
 * The session must be live (Go live in the dashboard) with no open poll. Daily is replaced by a test double on the
 * learner's page so no camera is needed.
 */
const env = {
  dashboard: process.env.LIVE_E2E_DASHBOARD_URL ?? '',
  site: process.env.LIVE_E2E_SITE_URL ?? '',
  session: process.env.LIVE_E2E_SESSION ?? '',
  staffEmail: process.env.LIVE_E2E_STAFF_EMAIL ?? '',
  staffPassword: process.env.LIVE_E2E_STAFF_PASSWORD ?? '',
  learnerEmail: process.env.LIVE_E2E_LEARNER_EMAIL ?? '',
  learnerPassword: process.env.LIVE_E2E_LEARNER_PASSWORD ?? '',
};
test.skip(
  Object.values(env).some((v) => !v),
  'Set the LIVE_E2E_* variables to run against a real stack.',
);

async function learnerRoom(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await installDailyDouble(page);
  const room = `/live/${env.session}/room`;
  await page.goto(`${env.site}/sign-in?next=${encodeURIComponent(room)}`);
  await page.getByLabel('Email').fill(env.learnerEmail);
  await page.getByLabel('Password', { exact: true }).fill(env.learnerPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname.endsWith(room));
  await expect(page.getByRole('list', { name: 'Room chat' }).or(page.getByText('No messages yet. Say hello!'))).toBeVisible();
  return page;
}

async function hostBooth(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${env.dashboard}/login`);
  await page.getByLabel('Email').fill(env.staffEmail);
  await page.getByLabel('Password').fill(env.staffPassword);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
  await page.goto(`${env.dashboard}/live?session=${env.session}`);
  const booth = page.getByRole('region', { name: /^Live booth · / });
  await expect(booth).toBeVisible({ timeout: 20_000 });
  return { page, booth };
}

test('the host hides a message and the learner’s page no longer shows it', async ({ browser }) => {
  const learner = await learnerRoom(browser);
  const text = `e2e message ${Date.now()}`;
  await learner.getByLabel('Message').fill(text);
  await learner.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(learner.getByRole('list', { name: 'Room chat' }).getByText(text)).toBeVisible();

  const { booth } = await hostBooth(browser);
  const line = booth.getByRole('listitem').filter({ hasText: text });
  await expect(line).toBeVisible({ timeout: 15_000 });
  await line.getByRole('button', { name: /^Hide message from / }).click();
  await expect(
    booth
      .getByRole('listitem')
      .filter({ hasText: text })
      .getByText(/hidden from learners/),
  ).toBeVisible();

  // The learner's room feed is re-read every 4 s: the message disappears without a reload…
  await expect(learner.getByText(text)).toHaveCount(0, { timeout: 15_000 });
  // …and the server never returns it again.
  await learner.reload();
  await expect(learner.getByRole('heading', { level: 2, name: 'Chat' })).toBeVisible();
  await expect(learner.getByText(text)).toHaveCount(0);
});

test('a poll the host launches is voted on once and its results show on both sides', async ({ browser }) => {
  const learner = await learnerRoom(browser);
  const { booth } = await hostBooth(browser);
  const question = `E2E poll ${Date.now()}`;
  const composer = booth.getByRole('form', { name: 'New poll' });
  await composer.getByLabel('Poll question').fill(question);
  await composer.getByLabel('Answer 1').fill('Yes');
  await composer.getByLabel('Answer 2').fill('Not yet');
  await composer.getByRole('button', { name: 'Launch poll' }).click();
  await expect(booth.getByText(new RegExp(`${question} · 0 votes`))).toBeVisible();

  const poll = learner.getByRole('region', { name: 'Poll' }).filter({ hasText: question });
  await expect(poll).toBeVisible({ timeout: 15_000 });
  await poll.getByText('Yes', { exact: true }).click();
  await expect(poll.getByText(/Thanks for voting · 1 vote so far/)).toBeVisible();
  await expect(poll.getByRole('radio', { name: /^Not yet/ })).toBeDisabled();

  // The host's booth picks the vote up on its next read.
  await expect(booth.getByText(new RegExp(`${question} · 1 vote`))).toBeVisible({ timeout: 15_000 });
  await booth.getByRole('button', { name: 'Close poll' }).click();
  await expect(learner.getByRole('region', { name: 'Poll results' }).filter({ hasText: question })).toBeVisible({ timeout: 15_000 });
});
