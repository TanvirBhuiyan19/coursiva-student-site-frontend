import { expect, test } from '@playwright/test';
import { installDailyDouble } from './daily';
import { resetData, signIn } from './helpers';

/** The built-in room's video (Daily Prebuilt) beside the room's own panels, with Daily replaced by a test double. */

test.beforeEach(async ({ page }) => {
  await resetData();
  await installDailyDouble(page);
});

test('the built-in room joins the video with a meeting token and keeps the panels working', async ({ page }) => {
  await signIn(page, 'amplify', '/live/evt_room/room');
  await expect(page.getByText('Live now')).toBeVisible();
  const frame = page.getByTitle('Live video for Office hours with Maya');
  await expect(frame).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __dailyJoins: { url: string; token: string }[] }).__dailyJoins))
    .toEqual([{ url: 'https://mock.daily.co/cv-evt_room', token: 'mock-daily-token-evt_room' }]);

  // Leaving the video keeps the learner in the room; rejoining asks for a fresh token.
  await page.evaluate(() => (window as unknown as { __dailyEmit: (n: string) => void }).__dailyEmit('left-meeting'));
  await expect(page.getByText('You left the video.')).toBeVisible();
  await page.getByRole('button', { name: 'Rejoin video' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __dailyJoins: unknown[] }).__dailyJoins.length)).toBe(2);

  await page.getByLabel('Message').fill('Hello from the room');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Room chat' }).getByText('Hello from the room')).toBeVisible();
});

test('the room fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await signIn(page, 'amplify', '/live/evt_room/room');
  const box = await page.getByTestId('daily-frame').boundingBox();
  expect(box?.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

/** The host's side of the room (the dashboard booth writes the same state through the API); mock-only hook. */
const host = (action: Record<string, unknown>) =>
  fetch('http://127.0.0.1:8797/__mock/live/amplify/evt_room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });

test('moderation: a message the host hides disappears from the learner’s chat; slow mode and the lock apply', async ({ page }) => {
  await signIn(page, 'amplify', '/live/evt_room/room');
  const chat = page.getByRole('list', { name: 'Room chat' });
  await page.getByLabel('Message').fill('Something rude');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(chat.getByText('Something rude')).toBeVisible();

  await host({ action: 'hide', text: 'Something rude' });
  // The room feed is re-read every 4 s: the message is gone without a reload, and stays gone after one.
  await expect(chat.getByText('Something rude')).toHaveCount(0, { timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole('list', { name: 'Room chat' }).getByText('Morning from Lisbon!')).toBeVisible();
  await expect(page.getByText('Something rude')).toHaveCount(0);

  await host({ action: 'announce', text: 'Break in five minutes' });
  await expect(page.getByRole('status').filter({ hasText: 'Break in five minutes' }).first()).toBeVisible({ timeout: 10_000 });

  await host({ action: 'slow', seconds: 30 });
  await expect(page.getByText('Slow mode: one message every 30 seconds.')).toBeVisible({ timeout: 10_000 });
  await page.getByLabel('Message').fill('First');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(/Slow mode: you can send again in \d+ seconds/)).toBeVisible();

  await host({ action: 'lock', on: true });
  await expect(page.getByText('The host has paused the chat.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel('Message')).toBeDisabled();
});

test('polls: the host launches a poll, the learner votes once and sees the live results', async ({ page }) => {
  await signIn(page, 'amplify', '/live/evt_room/room');
  await host({ action: 'poll', question: 'Ready for Q&A?', options: ['Yes', 'Not yet'] });
  const poll = page.getByRole('region', { name: 'Poll' }).filter({ hasText: 'Ready for Q&A?' });
  await expect(poll).toBeVisible({ timeout: 10_000 });
  await poll.getByText('Yes', { exact: true }).click();
  await expect(poll.getByText('Thanks for voting · 1 vote so far')).toBeVisible();
  await expect(poll.getByRole('progressbar', { name: 'Yes' })).toHaveAttribute('aria-valuenow', '100');
  await expect(poll.getByRole('radio', { name: /^Not yet/ })).toBeDisabled();
  // The vote is final on the server too.
  await host({ action: 'closePoll' });
  await expect(page.getByRole('region', { name: 'Poll results' }).filter({ hasText: 'Ready for Q&A?' })).toBeVisible({ timeout: 10_000 });
});

test('stage and removal: the learner accepts a stage invite (fresh video token) and a removal ends the room', async ({ page }) => {
  await signIn(page, 'amplify', '/live/evt_room/room');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __dailyJoins: unknown[] }).__dailyJoins.length)).toBe(1);
  await host({ action: 'stage', email: 'jordan.tate@gmail.com' });
  await page.getByRole('button', { name: 'Join the stage' }).click({ timeout: 10_000 });
  await expect(page.getByText(/You’re on stage/)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __dailyJoins: { token: string }[] }).__dailyJoins.at(-1)?.token))
    .toBe('mock-daily-token-evt_room-stage');

  await host({ action: 'remove', email: 'jordan.tate@gmail.com' });
  // (Next's route announcer is an empty alert too.)
  await expect(page.getByRole('alert').filter({ hasText: /The host removed you from this session/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('daily-frame')).toHaveCount(0);
});

test('breakout rooms: the learner follows the host into their room, sees broadcasts and returns to the main room', async ({ page }) => {
  await signIn(page, 'amplify', '/live/evt_room/room');
  const lastToken = () => page.evaluate(() => (window as unknown as { __dailyJoins: { token: string }[] }).__dailyJoins.at(-1)?.token);
  await expect.poll(lastToken).toBe('mock-daily-token-evt_room');

  await host({ action: 'breakout', email: 'jordan.tate@gmail.com' });
  await expect(page.getByText(/You’re in breakout room Room 1/)).toBeVisible({ timeout: 10_000 });
  // The video rejoins the breakout room's own Daily room with a token for it.
  await expect.poll(lastToken).toMatch(/^mock-daily-token-lbr_/);

  await host({ action: 'broadcast', text: 'Two minutes left' });
  await expect(page.getByText('Two minutes left').first()).toBeVisible({ timeout: 10_000 });

  await host({ action: 'closeBreakouts' });
  await expect(page.getByText(/You’re in breakout room/)).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(lastToken).toBe('mock-daily-token-evt_room');
});
