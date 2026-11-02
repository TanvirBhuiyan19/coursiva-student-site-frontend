// SMS short links: the proxy streams `/l/{code}` to the API (`GET /api/v1/l/{code}`) like `/api/*`.
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { shortLinkApiPath } from './shortLinks';

vi.mock('server-only', () => ({}));
vi.mock('@/config/env', () => ({
  env: {
    API_URL: 'http://api.test',
    API_SERVICE_TOKEN: 'token',
    SESSION_COOKIE: 'coursiva_learner_session',
    ANALYTICS_PAGEVIEWS: 'off',
    dashboardOrigins: [],
    noindexHosts: [],
    isDev: false,
  },
}));
vi.mock('@/features/tenant/resolve', () => ({
  resolveTenant: () =>
    Promise.resolve({
      tenant: 'amplify',
      primaryHost: 'amplify.example.com',
      status: 'active',
      indexable: true,
      defaultLocale: 'en-US',
      locales: ['en-US', 'es-ES'],
    }),
  isBareDevHost: () => false,
  isNoindexHost: () => false,
}));
vi.mock('@/features/seo/redirects', () => ({
  edgeRedirect: () => Promise.resolve(null),
  reportRedirectHit: () => Promise.resolve(),
}));

const request = (path: string) =>
  new NextRequest(`https://amplify.example.com${path}`, {
    headers: { host: 'amplify.example.com', authorization: 'Bearer stolen', 'user-agent': 'Mozilla/5.0' },
  });

describe('SMS short links', () => {
  it('recognises 8–12 base62 codes only', () => {
    expect(shortLinkApiPath('/l/Ab3dE6gH')).toBe('/api/v1/l/Ab3dE6gH');
    expect(shortLinkApiPath('/l/Ab3dE6gH12xY')).toBe('/api/v1/l/Ab3dE6gH12xY');
    expect(shortLinkApiPath('/l/short')).toBeNull();
    expect(shortLinkApiPath('/l/Ab3dE6gH12xYz')).toBeNull();
    expect(shortLinkApiPath('/l/Ab3d-6gH')).toBeNull();
    expect(shortLinkApiPath('/l/Ab3dE6gH/x')).toBeNull();
    expect(shortLinkApiPath('/es/l/Ab3dE6gH')).toBeNull();
  });

  it('forwards /l/{code} to the API with the tenant attached and no locale rewrite', async () => {
    const res = await proxy(request('/l/Ab3dE6gH?x=1'));
    expect(res.headers.get('x-middleware-rewrite')).toBe('http://api.test/api/v1/l/Ab3dE6gH?x=1');
    expect(res.headers.get('x-middleware-request-x-tenant')).toBe('amplify');
    expect(res.headers.get('x-middleware-request-x-forwarded-host')).toBe('amplify.example.com');
    expect(res.headers.get('x-middleware-request-authorization')).toBeNull();
    expect(res.headers.get('content-language')).toBeNull();
    expect(res.headers.get('location')).toBeNull();
  });

  it('leaves other /l/ paths to the site', async () => {
    const res = await proxy(request('/l/nope'));
    expect(res.headers.get('x-middleware-rewrite')).toBe('https://amplify.example.com/amplify/en-US/l/nope');
  });
});
