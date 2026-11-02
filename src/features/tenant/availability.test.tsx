// Platform feature availability on the storefront (docs/api/tenant.md): `unavailable` from `GET /site` hides Live,
// webinars, community, certificates, sign-in options, SSO and the AI tutor.
import type { ReactNode } from 'react';
import { headerItems } from '@/components/layout/SiteHeader';
import { normalizeSite, siteAvailable } from './normalize';
import type { Site } from './types';

const getCurrentSite = vi.fn<() => Promise<Site>>();
vi.mock('./server', () => ({ getCurrentSite: () => getCurrentSite() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const raw = (extra: Record<string, unknown> = {}) => ({
  name: 'Amplify',
  oauthProviders: ['google'],
  ssoEnabled: true,
  features: { membership: true, community: true, certificates: true, streaks: true },
  navigation: {
    header: {
      items: [
        { label: 'Courses', href: '/courses' },
        { label: 'Live', href: '/live' },
        { label: 'Webinar', href: '/webinars/growth-clinic' },
        { label: 'Community', href: '/community' },
      ],
    },
  },
  ...extra,
});

describe('storefront availability', () => {
  it('defaults to everything available (an older payload has no `unavailable`)', () => {
    const site = normalizeSite(raw());
    expect(site.unavailable).toEqual([]);
    expect(siteAvailable(site, 'live_classes')).toBe(true);
    expect(site.oauthProviders).toEqual(['google']);
    expect(site.ssoEnabled).toBe(true);
    expect(headerItems(site).map((i) => i.href)).toEqual(['/courses', '/live', '/webinars/growth-clinic', '/community']);
  });

  it('hides switched-off sign-in providers, SSO, community and certificates even from a stale payload', () => {
    const site = normalizeSite(raw({ unavailable: ['signin_google', 'sso', 'community', 'certs'] }));
    expect(site.oauthProviders).toEqual([]);
    expect(site.ssoEnabled).toBe(false);
    expect(site.features).toEqual({ membership: true, community: false, certificates: false, streaks: true });
    expect(headerItems(site).map((i) => i.href)).toEqual(['/courses', '/live', '/webinars/growth-clinic']);
  });

  it('drops header links to Live and webinars while live classes are off', () => {
    const site = normalizeSite(raw({ unavailable: ['live_classes'] }));
    expect(headerItems(site).map((i) => i.href)).toEqual(['/courses', '/community']);
  });

  it('404s every live and webinar route while live classes are off', async () => {
    const { default: LiveLayout } = await import('@/app/[tenant]/[locale]/live/layout');
    const { default: WebinarsLayout } = await import('@/app/[tenant]/[locale]/webinars/layout');
    const child: ReactNode = 'page';
    getCurrentSite.mockResolvedValue(normalizeSite(raw()));
    await expect(LiveLayout({ children: child })).resolves.toBe('page');
    getCurrentSite.mockResolvedValue(normalizeSite(raw({ unavailable: ['live_classes'] })));
    await expect(LiveLayout({ children: child })).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(WebinarsLayout({ children: child })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
