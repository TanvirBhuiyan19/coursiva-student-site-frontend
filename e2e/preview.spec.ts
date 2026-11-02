import { expect, test } from '@playwright/test';
import { hostGet, resetData, tenantUrl } from './helpers';

/**
 * The staff course preview (course builder O7): the real player for a virtual learner, framable only by the dashboard,
 * with no session, no cookies and no learner requests.
 */
const TOKEN = 'pv_launchlab_working_day0_demo_000000000000';

test.beforeEach(() => resetData());

test('serves the preview with its own framing, referrer and robots policy', async ({ request }) => {
  const res = await hostGet(request, 'amplify.localhost', `/preview/${TOKEN}`);
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h['content-security-policy']).toMatch(/^frame-ancestors http:\/\/app\.localhost:5174; /);
  expect(h['x-frame-options']).toBeUndefined();
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['x-robots-tag']).toContain('noindex');
  expect(h['set-cookie']).toBeUndefined();
  // Every other page still refuses to be framed.
  const home = (await hostGet(request, 'amplify.localhost', '/')).headers();
  expect(home['content-security-policy']).toMatch(/^frame-ancestors 'none'; /);
  expect(home['x-frame-options']).toBe('DENY');
  // A dead link: the expired page.
  const expired = await hostGet(request, 'amplify.localhost', '/preview/pv_launchlab_expired_demo_0000000000000000');
  expect(expired.status()).toBe(404);
  expect(await expired.text()).toContain('This preview has expired — open it again from the builder.');
});

test('plays the course like a learner without reporting anything', async ({ page, context }) => {
  const api: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/sanctum/')) api.push(`${r.method()} ${url.pathname}`);
  });
  await page.goto(tenantUrl('amplify', `/preview/${TOKEN}?lesson=les_l_draft_0`));
  await expect(page.getByRole('region', { name: 'Preview' })).toContainText('Preview · Day 0 · Working copy');
  // No account UI: no site header, no sign-in.
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);

  const form = page.getByRole('form', { name: 'Which stage turns visitors into leads?' });
  await form.getByRole('radio', { name: 'Convert' }).check();
  await form.getByRole('button', { name: 'Check' }).click();
  await expect(form.getByRole('status')).toContainText('Correct!');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('form', { name: /Which belong on a landing page/ })).toBeVisible();

  // Locked lessons open under a banner; the outline stays in the preview.
  await page.getByRole('link', { name: /Post-launch review/ }).click();
  await expect(page).toHaveURL(tenantUrl('amplify', `/preview/${TOKEN}?lesson=les_l_2_5`));
  await expect(page.getByRole('note').first()).toContainText('Learners can’t open this yet — Opens in 14 days');

  expect(api).toEqual([`POST /api/v1/preview/${TOKEN}/lessons/les_l_draft_0/blocks/blk_demo000000000018/check`]);
  expect(await context.cookies()).toEqual([]);
});
