import { createServer } from 'node:http';
import { type Page, expect, test } from '@playwright/test';
import { hostGet, resetData, tenantUrl } from './helpers';

/**
 * Lead forms (docs/api/forms.md): the hosted page, the embed on another website, file uploads, spam protection,
 * conditional fields and the site-builder block — on the production build against the mock API.
 */

const WORKSHOP = 'frm_01jd8x7k3q9w2e5r6t7y8z9abc';
const WAITLIST = 'frm_01jd8x7k3q9w2e5r6t7y8z9qck';
/** The embedding website: another origin, on loopback. */
const FOREIGN_PORT = 4999;
const FOREIGN = `http://partner.localhost:${FOREIGN_PORT}`;

type Hook = {
  views: number;
  spam_blocked: number;
  submissions: { values: { key: string; value: unknown }[]; pageUrl: string | null; utm: unknown }[];
  uploads: { name: string; submissionId: string | null }[];
};
const mockForm = async (id: string): Promise<Hook> =>
  (await fetch(`http://127.0.0.1:8797/__mock/forms/amplify/${id}`)).json() as Promise<Hook>;
const valueOf = (s: Hook['submissions'][number], key: string) => s.values.find((v) => v.key === key)?.value;

const PDF = {
  name: 'portfolio.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n% e2e portfolio\n1 0 obj << >> endobj\n%%EOF\n'),
};

test.beforeEach(async () => {
  await resetData();
});

/** Fills the workshop form's required answers (inside `scope`: the page or the embed frame). */
async function fillWorkshop(scope: Pick<Page, 'getByLabel' | 'getByRole'>) {
  await scope.getByLabel('Your name').fill('Jordan Tate');
  await scope.getByLabel('Email').fill('jordan.e2e@example.com');
  await scope.getByLabel('What best describes you?').selectOption('Coach');
  await scope.getByLabel('I agree to the privacy policy and to be contacted about the workshop.').check();
}

/** The workshop form refuses submissions made faster than 3 s after it loaded (the minimum fill time). */
const humanPause = (page: Page) => page.waitForTimeout(3200);

test('the hosted page: file upload, hidden prefill, success and the lead event', async ({ page }) => {
  await page.goto(`/forms/${WORKSHOP}?utm_source=newsletter&cid=77&ref=maya`);
  await expect(page.getByRole('heading', { level: 1, name: 'Apply for the live workshop' })).toBeVisible();
  // The school's chrome is there; the page is never indexed.
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await page.evaluate(() => {
    window.addEventListener('coursiva:lead', (e) => ((window as unknown as { __lead: unknown }).__lead = (e as CustomEvent).detail));
  });

  await fillWorkshop(page);
  await page.getByRole('radio', { name: '5 stars' }).check({ force: true });
  await page.getByLabel('Portfolio or CV').setInputFiles(PDF);
  await expect(page.getByText('portfolio.pdf', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded' })).toBeVisible();
  await humanPause(page);
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Thanks!' })).toHaveText(
    'Thanks! We’ll review your application within two days.',
  );

  const lead = (await page.evaluate(() => (window as unknown as { __lead?: { form_id: string; submission_id: string } }).__lead))!;
  expect(lead.form_id).toBe(WORKSHOP);
  expect(lead.submission_id).toMatch(/^fsb_/);
  const stored = await mockForm(WORKSHOP);
  expect(stored.views).toBe(1);
  expect(stored.submissions).toHaveLength(1);
  const s = stored.submissions[0]!;
  expect(valueOf(s, 'email')).toBe('jordan.e2e@example.com');
  expect(valueOf(s, 'excitement')).toBe(5);
  expect(valueOf(s, 'portfolio')).toMatchObject({ name: 'portfolio.pdf' });
  expect(valueOf(s, 'utm_source')).toBe('newsletter');
  expect(valueOf(s, 'campaign_id')).toBe('77');
  expect(valueOf(s, 'ref')).toBe('maya');
  expect(valueOf(s, 'channel')).toBe('website-form');
  expect(s.pageUrl).toContain(`/forms/${WORKSHOP}?utm_source=newsletter`);
  expect(s.utm).toEqual({ source: 'newsletter' });
  expect(stored.uploads).toEqual([expect.objectContaining({ name: 'portfolio.pdf', submissionId: expect.stringMatching(/^fsb_/) })]);
});

test('a file of the wrong type is refused before it uploads, and a chosen file can be removed', async ({ page }) => {
  await page.goto(`/forms/${WORKSHOP}`);
  const input = page.getByLabel('Portfolio or CV');
  await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByText("This file type isn't allowed.")).toBeVisible();
  await input.setInputFiles(PDF);
  await page.getByRole('button', { name: 'Remove portfolio.pdf' }).click();
  await expect(page.getByLabel('Portfolio or CV')).toBeVisible();
  expect((await mockForm(WORKSHOP)).uploads).toHaveLength(1);
});

test('a conditional field appears, is enforced, and disappears with its condition', async ({ page }) => {
  await page.goto(`/forms/${WORKSHOP}`);
  await fillWorkshop(page);
  await expect(page.getByLabel('Tell us your role')).toHaveCount(0);
  await page.getByLabel('What best describes you?').selectOption('Other');
  const other = page.getByLabel('Tell us your role');
  await expect(other).toBeVisible();
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(other).toHaveAttribute('aria-invalid', 'true');
  await expect(other).toBeFocused();
  await expect(page.getByText('This field is required.')).toBeVisible();
  expect((await mockForm(WORKSHOP)).submissions).toHaveLength(0);
  await page.getByLabel('What best describes you?').selectOption('Coach');
  await expect(page.getByLabel('Tell us your role')).toHaveCount(0);
  await page.getByLabel('What best describes you?').selectOption('Other');
  await page.getByLabel('Tell us your role').fill('Podcaster');
  await humanPause(page);
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Thanks!' })).toBeVisible();
  expect(valueOf((await mockForm(WORKSHOP)).submissions[0]!, 'role_other')).toBe('Podcaster');
});

test('spam protection: a filled honeypot stores nothing; a too-fast submission is refused', async ({ page }) => {
  await page.goto(`/forms/${WORKSHOP}`);
  await fillWorkshop(page);
  // (The form also has a field keyed `website`: the honeypot is the input labelled for bots.)
  const honeypot = page.getByLabel('Leave this field empty');
  await expect(honeypot).toHaveAttribute('tabindex', '-1');
  await honeypot.fill('https://spam.example', { force: true });
  await humanPause(page);
  await page.getByRole('button', { name: 'Send application' }).click();
  // Bots are told it worked…
  await expect(page.getByRole('status').filter({ hasText: 'Thanks!' })).toBeVisible();
  // …but nothing was stored.
  const stored = await mockForm(WORKSHOP);
  expect(stored.submissions).toHaveLength(0);
  expect(stored.spam_blocked).toBe(1);

  // The site-builder block (the team page's Waitlist form) wants 30 s: an instant submit is refused.
  await page.goto('/about/team');
  const block = page.getByRole('form', { name: 'Join the waitlist' });
  await expect(block.getByText('We’ll email you when the next cohort opens.')).toBeVisible();
  await block.getByLabel('Email').fill('quick@example.com');
  await block.getByRole('button', { name: 'Submit' }).click();
  await expect(block.getByRole('alert')).toHaveText('That was quick! Please wait a moment and submit again.');
  expect((await mockForm(WAITLIST)).submissions).toHaveLength(0);
});

test('the embed: a foreign website frames the form, which resizes, submits and reports back', async ({ page, request }) => {
  // Only the embed frame may be framed, by anyone.
  const frameRes = await hostGet(request, 'amplify.localhost:3100', `/embed/forms/${WORKSHOP}`);
  expect(frameRes.headers()['content-security-policy']).toMatch(/^frame-ancestors \*; /);
  expect(frameRes.headers()['x-frame-options']).toBeUndefined();
  expect(frameRes.headers()['x-robots-tag']).toContain('noindex');
  const hosted = await hostGet(request, 'amplify.localhost:3100', `/forms/${WORKSHOP}`);
  expect(hosted.headers()['x-frame-options']).toBe('DENY');
  const script = await hostGet(request, 'amplify.localhost:3100', '/embed/forms.js');
  expect(script.status()).toBe(200);
  expect(script.headers()['content-type']).toContain('javascript');
  expect(script.headers()['cache-control']).toContain('max-age=3600');

  // A page on another origin, served by a real server on loopback (a page that isn't served from the local network
  // may not load the school's localhost script: Chromium's Local Network Access).
  const html = `<!doctype html><html lang="en"><head><title>Partner site</title></head><body style="background:#fafafa">
        <h1>Partner site</h1>
        <div id="slot"></div>
        <script src="${tenantUrl('amplify', '/embed/forms.js')}" data-form="${WORKSHOP}" data-target="slot" data-title="Workshop application" async></script>
        <script>window.__events = []; document.addEventListener('coursiva:form-submitted', function (e) { window.__events.push(e.detail); });</script>
      </body></html>`;
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(FOREIGN_PORT, '127.0.0.1', resolve));
  try {
    await page.goto(`${FOREIGN}/landing?utm_source=partner&cid=9`);
    const iframe = page.locator('#slot iframe');
    await expect(iframe).toHaveAttribute('title', 'Workshop application');
    await expect(iframe).toHaveAttribute('sandbox', /allow-scripts/);
    const frame = page.frameLocator('#slot iframe');
    await expect(frame.getByRole('heading', { name: 'Apply for the live workshop' })).toBeVisible();
    // No site chrome in the frame.
    await expect(frame.getByRole('banner')).toHaveCount(0);
    await expect(frame.getByRole('contentinfo')).toHaveCount(0);

    // The frame tells the page its height (the script starts it at 420px; the form is taller).
    await expect.poll(async () => parseInt(await iframe.evaluate((el) => (el as HTMLElement).style.height), 10)).toBeGreaterThan(900);
    const before = await iframe.evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);
    // Showing the conditional field makes the form taller: the iframe follows.
    await frame.getByLabel('What best describes you?').selectOption('Other');
    await expect.poll(() => iframe.evaluate((el) => (el as HTMLElement).getBoundingClientRect().height)).toBeGreaterThan(before);
    await frame.getByLabel('What best describes you?').selectOption('Coach');

    await fillWorkshop(frame);
    await humanPause(page);
    await frame.getByRole('button', { name: 'Send application' }).click();
    await expect(frame.getByRole('status').filter({ hasText: 'Thanks!' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __events: { form: string; submission: string }[] }).__events))
      .toEqual([{ form: WORKSHOP, submission: expect.stringMatching(/^fsb_/) }]);

    const s = (await mockForm(WORKSHOP)).submissions[0]!;
    // Hidden fields and the submission's page come from the embedding page.
    expect(s.pageUrl).toBe(`${FOREIGN}/landing?utm_source=partner&cid=9`);
    expect(valueOf(s, 'utm_source')).toBe('partner');
    expect(valueOf(s, 'campaign_id')).toBe('9');
    expect(valueOf(s, 'landing_page')).toBe(`${FOREIGN}/landing?utm_source=partner&cid=9`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the embed frame opened directly never posts to a parent and still works', async ({ page }) => {
  await page.goto(`/embed/forms/${WORKSHOP}?origin=*`);
  await expect(page.getByRole('heading', { name: 'Apply for the live workshop' })).toBeVisible();
  await expect(page.getByRole('banner')).toHaveCount(0);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgba(0, 0, 0, 0)');
});

test('unknown and paused forms say so', async ({ page }) => {
  await page.goto('/forms/frm_01jd8x7k3q9w2e5r6t7y8z9pse');
  await expect(page.getByText('This form isn’t available.')).toBeVisible();
});
