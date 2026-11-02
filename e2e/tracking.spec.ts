import { createHmac } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { resetData, signIn, tenantUrl } from './helpers';

/**
 * Tracking tags and conversion events (docs/consent.md → Tracking tags): the school's tag ids load only with the
 * visitor's consent, verification tags are server-rendered, and a purchase is sent once with the event id the API's
 * server-side copy uses. No third-party script is ever fetched: their hosts answer an empty script here.
 */

const TAG_HOSTS = /googletagmanager\.com|connect\.facebook\.net|analytics\.tiktok\.com|snap\.licdn\.com|clarity\.ms|mc\.yandex\.ru/;

const TRACKING = {
  ga4: 'G-ABCD1234',
  gtm: null,
  metaPixel: '123456789012345',
  tiktokPixel: 'C4A1B2C3D4E5F6G7H8I9',
  linkedinPartner: null,
  clarity: null,
  yandexMetrica: null,
  verification: { google: 'Ab_Cd-1234567890', bing: null, yandex: null, pinterest: null },
};

/** Drops the site's cached `GET /site` (the API calls this hook when the school changes its tags). */
async function revalidate(tenant: string) {
  const body = JSON.stringify({ tags: [`t:${tenant}`] });
  const signature = createHmac('sha256', 'dev-revalidate-secret').update(body).digest('hex');
  const res = await fetch('http://127.0.0.1:3100/hooks/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Coursiva-Signature': `sha256=${signature}` },
    body,
  });
  expect(res.status).toBe(200);
}

async function setTracking(tenant: string, tracking: typeof TRACKING | null = TRACKING) {
  await fetch(`http://127.0.0.1:8797/__mock/tracking/${tenant}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tracking),
  });
  await revalidate(tenant);
}

/** Every request to a tag host, answered with an empty script. */
async function stubTags(context: BrowserContext): Promise<string[]> {
  const hits: string[] = [];
  await context.route(TAG_HOSTS, (route) => {
    hits.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  return hits;
}

const fbqCalls = (page: Page) =>
  page.evaluate(() => ((window as unknown as { fbq?: { queue?: unknown[][] } }).fbq?.queue ?? []).map((c) => [...c]));

test.beforeEach(async () => {
  await resetData();
});

// Later specs must see the seed (no tags) again, not this spec's cached site.
test.afterEach(async () => {
  await resetData();
  await revalidate('northwind');
  await revalidate('amplify');
});

test('declining loads no tag; accepting loads the tags; verification is in the server HTML', async ({ page, context }) => {
  await setTracking('northwind');
  const hits = await stubTags(context);
  await page.goto(tenantUrl('northwind', '/'));
  await expect(page.locator('head meta[name="google-site-verification"]')).toHaveAttribute('content', 'Ab_Cd-1234567890');

  const banner = page.getByRole('region', { name: 'Cookie notice' });
  await banner.getByRole('button', { name: 'Decline' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(hits).toEqual([]);
  expect(await page.evaluate(() => typeof (window as unknown as { fbq?: unknown }).fbq)).toBe('undefined');

  await page.getByRole('contentinfo').getByRole('button', { name: 'Cookie settings' }).click();
  const panel = page.getByRole('region', { name: 'Cookie notice' });
  await panel.getByRole('checkbox', { name: /Analytics/ }).check();
  await panel.getByRole('checkbox', { name: /Marketing/ }).check();
  await panel.getByRole('button', { name: 'Save choices' }).click();
  await expect.poll(() => hits.some((u) => u.includes('gtag/js?id=G-ABCD1234'))).toBe(true);
  await expect.poll(() => hits.some((u) => u.includes('fbevents.js'))).toBe(true);
  await expect.poll(() => hits.some((u) => u.includes('sdkid=C4A1B2C3D4E5F6G7H8I9'))).toBe(true);
  const calls = await fbqCalls(page);
  expect(calls[0]).toEqual(['init', '123456789012345']);
  expect(calls.some((c) => c[1] === 'PageView')).toBe(true);
  // Consent Mode v2: denied by default, then the visitor's choice.
  const consent = await page.evaluate(() =>
    ((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? [])
      .filter((e) => e[0] === 'consent')
      .map((e) => [...Array.from(e)]),
  );
  expect(consent[0]).toEqual(['consent', 'default', expect.objectContaining({ ad_storage: 'denied', analytics_storage: 'denied' })]);
  expect(consent.at(-1)).toEqual(['consent', 'update', expect.objectContaining({ ad_storage: 'granted', analytics_storage: 'granted' })]);
});

test('a purchase is sent once, with the server’s event id, and the checkout carries the consent signal', async ({ page, context }) => {
  // Amplify's banner is off (opt-out): tags load at once.
  await setTracking('amplify');
  await stubTags(context);
  const checkoutBodies: unknown[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/checkout') checkoutBodies.push(r.postDataJSON());
  });
  await signIn(page, 'amplify', '/checkout?plan=plan_pro&interval=month');
  await expect.poll(async () => (await fbqCalls(page)).some((c) => c[1] === 'InitiateCheckout')).toBe(true);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.locator('form button[type=submit]', { hasText: /^Pay|Start/ }).click();
  await page.waitForURL((u) => u.pathname.startsWith('/checkout/success/'), { timeout: 15_000 });
  const orderId = page.url().split('/checkout/success/')[1]!.split(/[?#]/)[0]!;

  expect(checkoutBodies[0]).toMatchObject({ tracking: { analytics: true, marketing: true } });
  await expect.poll(async () => (await fbqCalls(page)).filter((c) => c[1] === 'Purchase')).toHaveLength(1);
  const purchase = (await fbqCalls(page)).find((c) => c[1] === 'Purchase')!;
  expect(purchase[3]).toEqual({ eventID: `purchase_${orderId}` });

  await page.reload();
  await expect.poll(async () => (await fbqCalls(page)).some((c) => c[1] === 'PageView')).toBe(true);
  expect((await fbqCalls(page)).filter((c) => c[1] === 'Purchase')).toHaveLength(0);
});
