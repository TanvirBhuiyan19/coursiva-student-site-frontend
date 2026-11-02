import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { resetData, signIn } from './helpers';

test.beforeEach(async () => {
  await resetData();
});

const LESSON = '/learn/launch-lab/les_l_2_8';

test('a learner answers a Survey lesson, sees their answers and the lesson completes', async ({ page }) => {
  await signIn(page, 'amplify', LESSON);
  await expect(page.getByRole('heading', { level: 1, name: 'Launch Lab feedback' })).toBeVisible();
  await expect(page.getByText('Tell us how the lab went')).toBeVisible();
  await expect(page.getByText('Answer the survey to complete this lesson')).toBeVisible();
  // Survey lessons complete on submit: no "Mark complete".
  await expect(page.getByRole('button', { name: 'Mark complete' })).toHaveCount(0);

  // The required rating is checked before sending.
  await page.getByRole('button', { name: 'Send answers' }).click();
  const rating = page.getByRole('radiogroup', { name: /How would you rate Launch Lab\?/ });
  await expect(rating).toHaveAttribute('aria-invalid', 'true');
  await expect(rating.getByText('This question needs an answer.')).toBeVisible();

  // Keyboard: focus the rating group and move with the arrow keys.
  await rating.getByText('3', { exact: true }).click();
  await expect(rating.getByRole('radio', { name: '3 out of 5' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(rating.getByRole('radio', { name: '4 out of 5' })).toBeChecked();
  await page.getByLabel('What helped you most?').fill('The peer reviews on my landing page.');
  await page.getByRole('radiogroup', { name: 'How was the pace?' }).getByText('Just right').click();
  await page.getByRole('checkbox', { name: 'I would recommend Launch Lab to a friend' }).check();
  await page.getByRole('spinbutton', { name: 'Hours spent per week' }).fill('4');

  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);

  await page.getByRole('button', { name: 'Send answers' }).click();
  await expect(page.getByText('Thanks — your answers are in.')).toBeVisible();
  const answers = page.locator('dl');
  await expect(answers.getByText('4 out of 5')).toBeVisible();
  await expect(answers.getByText('The peer reviews on my landing page.')).toBeVisible();
  await expect(answers.getByText('Just right')).toBeVisible();
  await expect(answers.getByText('Yes')).toBeVisible();
  await expect(page.getByText(/^Submitted /)).toBeVisible();
  await expect(page.getByText('✓ Completed')).toBeVisible();
  await expect(page.getByRole('link', { name: /Launch Lab feedback \(completed\)/ })).toBeVisible();

  // Re-submitting is on: edit (pre-filled) and send again; the answers survive a reload.
  await page.getByRole('button', { name: 'Edit your answers' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Hours spent per week' })).toHaveValue('4');
  await page
    .getByRole('radiogroup', { name: /How would you rate/ })
    .getByText('5', { exact: true })
    .click();
  await page.getByRole('button', { name: 'Update answers' }).click();
  await expect(answers.getByText('5 out of 5')).toBeVisible();
  await page.reload();
  await expect(page.locator('dl').getByText('5 out of 5')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit your answers' })).toBeVisible();
});
