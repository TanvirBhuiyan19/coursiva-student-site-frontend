import { expect, test } from '@playwright/test';
import { resetData, signIn, tenantUrl } from './helpers';

test.beforeEach(async () => {
  await resetData();
});

test('a SCORM 1.2 package talks to window.API and completes the lesson', async ({ page }) => {
  await signIn(page, 'amplify', '/learn/launch-lab/les_l_0_1');
  await expect(page.getByRole('heading', { level: 1, name: 'Funnel simulator' })).toBeVisible();
  const sco = page.frameLocator('iframe[title="Funnel simulator"]');
  await expect(sco.getByText(/Hello Tate, Jordan/)).toBeVisible();
  await sco.getByRole('button', { name: 'Checkout' }).click();
  await expect(page.getByText('✓ You’ve finished this interactive lesson.').first()).toBeVisible();
  // No "Mark complete" for packages: the API decides.
  await expect(page.getByRole('button', { name: 'Mark complete' })).toHaveCount(0);
});

test('written quiz answers wait for the instructor’s review', async ({ page }) => {
  await signIn(page, 'amplify', '/learn/launch-lab/les_l_0_2');
  await expect(page.getByText(/Your last attempt was reviewed: 50%/)).toBeVisible();
  await page.getByText('Landing page', { exact: true }).click();
  await page.getByText('Opt-in rate', { exact: true }).click();
  await page.getByText('Click-through rate', { exact: true }).click();
  await page.getByLabel('Your answer').fill('I will rewrite the headline and test it for a week.');
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page.getByText('Awaiting review')).toBeVisible();
  await expect(page.getByText(/automatically marked part scored 100%/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retake quiz' })).toHaveCount(0);
});

test('submit an assignment, then review a classmate’s work', async ({ page }) => {
  await signIn(page, 'amplify', '/learn/launch-lab/les_l_1_2');
  await expect(page.getByText(/Weekly assignment, due on Fridays/)).toBeVisible();
  await page.getByLabel('Your answer').fill('Headline: launch your first course in 30 days.');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByText('Waiting to be graded')).toBeVisible();
  await expect(page.getByText('0 of 2 reviews done')).toBeVisible();

  await page.goto(tenantUrl('amplify', '/learn/launch-lab/les_l_1_3'));
  await expect(page.getByText(/notes\.docx · removed — this file contained malware/)).toBeVisible();
  await expect(page.getByText('Feedback from classmates')).toBeVisible();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const who = page.getByRole('group', { name: /Who it is for/ });
  await who.getByText('4', { exact: true }).click();
  await page
    .getByRole('group', { name: /Why you/ })
    .getByText('3', { exact: true })
    .click();
  await page.getByRole('button', { name: 'Submit review' }).click();
  await expect(page.getByText('Review saved — thanks for the feedback')).toBeVisible();
  await expect(page.getByText('2 of 2 reviews done')).toBeVisible();
});

test('ask the AI tutor and hand an uncovered question to the team', async ({ page }) => {
  await signIn(page, 'amplify', '/learn/launch-lab/les_l_0_0');
  await page.getByRole('button', { name: 'Ask the tutor' }).click();
  await page.getByLabel('Your question for the tutor').fill('How does the funnel simulator work?');
  await page.getByRole('button', { name: 'Ask', exact: true }).first().click();
  await expect(page.getByText(/“Funnel simulator” covers this/)).toBeVisible();
  await page.getByLabel('Your question for the tutor').fill('Can I get a refund?');
  await page.getByRole('button', { name: 'Ask', exact: true }).first().click();
  await page.getByRole('button', { name: 'Ask the team' }).click();
  await expect(page.getByText(/Sent to the course team/)).toBeVisible();
});

test('sign-in offers SSO and explains failed social sign-ins', async ({ page }) => {
  await page.goto(tenantUrl('amplify', '/sign-in?error=oauth&reason=denied'));
  await expect(page.locator('.alert-bad')).toContainText('Sign-in was cancelled');
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in with your organization (SSO)' })).toHaveAttribute(
    'href',
    '/api/v1/auth/saml/login?next=%2Flearning',
  );
  await page.goto(tenantUrl('amplify', '/sign-in?sso_error=expired'));
  await expect(page.locator('.alert-bad')).toContainText('single sign-on response expired');
  await page.goto(tenantUrl('northwind', '/sign-in'));
  await expect(page.getByRole('link', { name: /SSO/ })).toHaveCount(0);
});

test('certificates offer the Open Badge download when published', async ({ page }) => {
  await signIn(page, 'amplify', '/certificates');
  await expect(page.getByRole('link', { name: 'Download Open Badge' })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Download Open Badge' })).toHaveAttribute(
    'href',
    '/api/v1/me/certificates/AC-2026-0341/credential',
  );
});
