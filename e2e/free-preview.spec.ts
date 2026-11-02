import { expect, test } from '@playwright/test';
import { hostGet, resetData, tenantUrl } from './helpers';

/**
 * Every free-preview lesson opens for guests on the course page (docs/api/catalog.md → GET /courses/{slug}/preview):
 * a "Preview" button on each free row, the cover's play overlay, and a modal with a "Free previews" list to switch
 * between them. On amplify, `the-funnel-blueprint` has a video, a PDF and a quiz free; `launch-lab` a text lesson with
 * knowledge checks.
 */
test.beforeEach(() => resetData());

test('every free-preview row has a Preview button, and the modal switches between them', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/courses/the-funnel-blueprint'));
  const curriculum = page.locator('#curriculum');
  const chips = curriculum.getByRole('button', { name: /^Preview/ });
  await expect(chips).toHaveCount(3);
  // Visible pills on their rows (module 1 is open on load).
  await curriculum
    .locator('details')
    .first()
    .evaluate((d) => ((d as HTMLDetailsElement).open = true));
  for (const chip of await chips.all()) await expect(chip).toBeVisible();

  // The cover's play overlay opens the first free preview: the video.
  await page.getByRole('button', { name: 'Preview this course' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { level: 3, name: 'Welcome & how this course works' })).toBeVisible();
  await expect(dialog.locator('iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed/);
  const list = dialog.getByRole('navigation', { name: 'Free previews' });
  await expect(list.getByRole('button')).toHaveCount(3);

  // The PDF opens in the inline viewer.
  await list.getByRole('button', { name: /Funnel mapping worksheet/ }).click();
  await expect(dialog.getByRole('heading', { level: 3, name: 'Funnel mapping worksheet' })).toBeVisible();
  await expect(dialog.locator('iframe[title="PDF: Funnel mapping worksheet.pdf"]')).toHaveAttribute('src', /\/preview\/files\/les_f_0_2$/);
  await expect(dialog.locator('object, embed')).toHaveCount(0);

  // The quiz: its summary and "Enrol to take this", never a question or an answer.
  await list.getByRole('button', { name: /Foundations check/ }).click();
  const inside = dialog.getByRole('region', { name: 'What’s inside' });
  await expect(inside).toContainText('3 questions');
  await expect(inside).toContainText('Enrol to take this.');
  await expect(dialog).not.toContainText('What is the primary job of the top of your funnel?');
  await expect(dialog.getByRole('radio')).toHaveCount(0);

  // Esc closes it and focus returns to the trigger.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Preview this course' })).toBeFocused();

  // A row's button opens on that lesson.
  await curriculum
    .locator('details')
    .first()
    .evaluate((d) => ((d as HTMLDetailsElement).open = true));
  await curriculum.getByRole('button', { name: /Preview.*Foundations check/ }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { level: 3, name: 'Foundations check' })).toBeVisible();
});

test('a text free preview renders its blocks, with checks guests can’t submit', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/courses/launch-lab'));
  await page
    .locator('#curriculum details')
    .nth(2)
    .evaluate((d) => ((d as HTMLDetailsElement).open = true));
  await page
    .locator('#curriculum')
    .getByRole('button', { name: /Preview.*Check your launch plan/ })
    .click();
  const dialog = page.getByRole('dialog');
  const region = dialog.getByRole('region', { name: 'Lesson content' });
  await expect(region).toContainText('Two quick questions about your launch plan.');
  await region.getByRole('radio', { name: 'A week before, to warm the list' }).check();
  await expect(region).toContainText('Sign in and enrol to check your answer.');
  await expect(region.getByRole('button', { name: 'Check' })).toHaveCount(0);
});

test('guests get only free-preview lessons, never cached', async ({ request }) => {
  const get = (q: string) => hostGet(request, 'amplify.localhost', `/api/v1/courses/the-funnel-blueprint/preview${q}`);
  const free = await get('?lesson=les_f_0_3');
  expect(free.status()).toBe(200);
  expect(free.headers()['cache-control']).toContain('no-store');
  const body = (await free.json()) as { data: { summary: { question_count: number }; quiz?: unknown } };
  expect(body.data.summary.question_count).toBe(3);
  expect(JSON.stringify(body)).not.toContain('answer');
  // A paid lesson (and an array id) is the same 404 as no preview.
  for (const q of ['?lesson=les_f_0_1', '?lesson[]=les_f_0_3']) {
    const res = await get(q);
    expect(res.status()).toBe(404);
    expect(((await res.json()) as { message: string }).message).toBe('This course has no preview.');
  }
});
