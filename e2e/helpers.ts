import type { APIRequestContext, Page } from '@playwright/test';
import { tenantUrl } from '../playwright.config';

export { tenantUrl };

/** Restore the mock API's seed so every test starts from the same data. */
export async function resetData() {
  await fetch('http://127.0.0.1:8797/__mock/reset', { method: 'POST' });
}

export async function signIn(page: Page, tenant = 'amplify', next = '/learning') {
  await page.goto(tenantUrl(tenant, `/sign-in?next=${encodeURIComponent(next)}`));
  await page.getByLabel('Email').fill('jordan.tate@gmail.com');
  await page.getByLabel('Password', { exact: true }).fill('password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => `${u.pathname}${u.search}` === next);
}

export async function jsonLd(page: Page): Promise<Record<string, unknown>[]> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.flatMap((b) => {
    const parsed = JSON.parse(b) as Record<string, unknown> | Record<string, unknown>[];
    return Array.isArray(parsed) ? parsed : [parsed];
  });
}

/**
 * Server-side requests (no browser). Node can't resolve *.localhost, so these go to 127.0.0.1 with the tenant's Host
 * header — exactly what a CDN does in front of the app.
 */
export async function hostGet(request: APIRequestContext, host: string, path: string, opts: { maxRedirects?: number } = {}) {
  return request.get(`http://127.0.0.1:3100${path}`, { headers: { Host: host }, ...opts });
}
