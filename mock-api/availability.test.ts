/**
 * Contract tests for platform feature availability (docs/api/tenant.md → Platform feature availability): what Laravel's
 * PublicSiteController and the learner endpoints answer once the console switches a capability off.
 */
import { app } from './app';
import { reset } from './lib/db';

/** A cookie-jar client on one tenant (as in app.test.ts). */
function browser(tenant: string) {
  const jar = new Map<string, string>();
  const send = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'X-Tenant': tenant, Accept: 'application/json' };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && jar.has('XSRF-TOKEN')) headers['X-XSRF-TOKEN'] = decodeURIComponent(jar.get('XSRF-TOKEN')!);
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair!.split('=');
      if (/Max-Age=0/i.test(c) || v === '') jar.delete(k!);
      else jar.set(k!, v!);
    }
    const text = await res.text();
    return { status: res.status, location: res.headers.get('Location'), json: text ? (JSON.parse(text) as Record<string, any>) : null };
  };
  return {
    get: (p: string) => send('GET', p),
    async signIn(email = 'jordan.tate@gmail.com', password = 'password') {
      await send('GET', '/sanctum/csrf-cookie');
      return send('POST', '/api/v1/auth/login', { email, password, remember: false });
    },
  };
}

const switchOff = (tenant: string, unavailable: string[]) =>
  app.request(`/__mock/availability/${tenant}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unavailable }),
  });

beforeEach(() => reset());

describe('platform feature availability', () => {
  it('sends an empty `unavailable` list while everything is on', async () => {
    const site = (await browser('amplify').get('/api/v1/site')).json!.data;
    expect(site.unavailable).toEqual([]);
    expect(site.oauth_providers).toEqual(['google']);
    expect(site.sso_enabled).toBe(true);
    expect(site.features).toMatchObject({ community: true, certificates: true });
  });

  it('applies switched-off capabilities to the site payload', async () => {
    expect((await switchOff('amplify', ['signin_google', 'sso', 'community', 'certs', 'live_classes'])).status).toBe(204);
    const site = (await browser('amplify').get('/api/v1/site')).json!.data;
    expect(site.unavailable).toEqual(['signin_google', 'sso', 'community', 'certs', 'live_classes']);
    expect(site.oauth_providers).toEqual([]);
    expect(site.sso_enabled).toBe(false);
    expect(site.features).toMatchObject({ membership: true, community: false, certificates: false, streaks: true });
  });

  it('refuses switched-off sign-in options and turns the AI tutor off', async () => {
    await switchOff('amplify', ['signin_google', 'sso', 'ai']);
    const b = browser('amplify');
    const google = await b.get('/api/v1/auth/oauth/google/redirect?next=/learning');
    expect(google.status).toBe(302);
    expect(google.location).toContain('reason=not_configured');
    expect((await b.get('/api/v1/auth/saml/login')).status).toBe(404);
    await b.signIn();
    expect((await b.get('/api/v1/me/courses/launch-lab/tutor')).json!.data).toEqual({ enabled: false, handoff: false, threads: [] });
  });

  it('rejects an unknown tenant', async () => {
    expect((await switchOff('ghost', ['ai'])).status).toBe(404);
  });
});
