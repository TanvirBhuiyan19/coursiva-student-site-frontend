import { describe, expect, it, vi } from 'vitest';
import { buildRobots, opensPrivate } from '@/lib/robots';
import { NOINDEX_PREFIXES } from '@/lib/routes';
import { blogPostingJsonLd, courseJsonLd } from '@/lib/seo';
import type { BlogPost } from '@/features/blog/types';
import type { Site } from '@/features/tenant/types';
import { DEFAULT_SEO, jsonLdText, normalizeSeo, overrideFor, schemaAllowed, schemaTypeOf, titleTemplate, unlisted } from './normalize';
import { forgetVisits, isSameOrigin, noteVisit, reportablePath, reportNotFound, takeVisit, visitOf, visitorOf } from './notFound';
import { indexRedirects, matchRedirect, pathKey, redirectLocation, resolveRedirect } from './rules';

vi.mock('server-only', () => ({}));
vi.mock('@/config/env', () => ({ env: { API_URL: 'http://api', API_SERVICE_TOKEN: 'token' } }));

/* The rule cases mirror Laravel's SeoToolsTest, Go's seo_test.go and the dashboard's seo-tools.test.tsx. */
const rules = [
  { id: 'rd_1', from: '/old-blog/*', to: '/blog/*', status: 301 as const, keepQuery: true },
  { id: 'rd_2', from: '/old-blog/special', to: '/courses', status: 302 as const, keepQuery: true },
  { id: 'rd_3', from: '/docs/*', to: '/help', status: 301 as const, keepQuery: true },
  { id: 'rd_4', from: '/docs/api/*', to: 'https://api.example.com/*', status: 301 as const, keepQuery: false },
  { id: 'rd_5', from: '/a', to: '/b', status: 301 as const, keepQuery: true },
  { id: 'rd_6', from: '/b', to: '/c?x=1', status: 302 as const, keepQuery: true },
  { id: 'rd_7', from: '/loop-a', to: '/loop-b', status: 301 as const, keepQuery: true },
  { id: 'rd_8', from: '/loop-b', to: '/loop-a', status: 301 as const, keepQuery: true },
];

describe('redirect rules', () => {
  it('matches exactly or by the longest prefix, ignoring case, slashes and the query string', () => {
    expect(pathKey('//Old-Blog//Post/?utm=1#x')).toBe('/old-blog/post');
    expect(matchRedirect(rules, '/old-blog/My-Post/')?.to).toBe('/blog/My-Post');
    expect(matchRedirect(rules, '/OLD-BLOG/special?ref=x')?.rule.id).toBe('rd_2');
    expect(matchRedirect(rules, '/old-blog')?.to).toBe('/blog');
    expect(matchRedirect(rules, '/old-blogger')).toBeNull();
    expect(matchRedirect(rules, '/docs/api/v1/users')?.to).toBe('https://api.example.com/v1/users');
    expect(matchRedirect(rules, '/docs/start/here')?.to).toBe('/help');
  });

  it('follows chains to one hop, 302 when any hop is temporary, and refuses loops', () => {
    expect(resolveRedirect(rules, '/a')).toMatchObject({ to: '/c?x=1', status: 302, rule: { id: 'rd_5' } });
    expect(resolveRedirect(rules, '/old-blog/x')).toMatchObject({ to: '/blog/x', status: 301 });
    expect(resolveRedirect(rules, '/loop-a')).toBeNull();
    // A hop's own query carries through the rest of the chain.
    expect(
      resolveRedirect([...rules, { id: 'rd_9', from: '/promo', to: '/a?ref=promo', status: 301, keepQuery: true }], '/promo')?.to,
    ).toBe('/c?x=1&ref=promo');
    expect(resolveRedirect(rules, '/nowhere')).toBeNull();
  });

  it('keeps the visitor’s query string unless the rule drops it (the destination’s own parameters win)', () => {
    expect(redirectLocation('/courses', '?utm_source=x&_rsc=1', true)).toBe('/courses?utm_source=x');
    expect(redirectLocation('/c?x=1', '?x=2&y=3', true)).toBe('/c?x=1&y=3');
    expect(redirectLocation('/c#top', '?y=3', true)).toBe('/c?y=3#top');
    expect(redirectLocation('/courses', '?utm=x', false)).toBe('/courses');
    expect(redirectLocation('https://example.com/p', '', true)).toBe('https://example.com/p');
  });

  it('serves redirects from the API table at the edge and counts nothing on failure', async () => {
    const { edgeRedirect, forgetRedirects } = await import('./redirects');
    forgetRedirects();
    const ok = vi.fn(() => Promise.resolve(Response.json({ data: rules.map((r) => ({ ...r, keep_query: r.keepQuery })) })));
    expect(await edgeRedirect('amplify', '/a', '?utm=1', ok)).toEqual({ location: '/c?x=1&utm=1', status: 302, id: 'rd_5' });
    expect(await edgeRedirect('amplify', '/docs/api/x', '?utm=1', ok)).toEqual({
      location: 'https://api.example.com/x',
      status: 301,
      id: 'rd_4',
    });
    expect(ok).toHaveBeenCalledTimes(1); // held in memory
    // A language prefix: the rule for the rest of the path, the prefix kept on a path destination.
    expect(await edgeRedirect('amplify', '/old-blog/x', '', ok, '/es')).toMatchObject({ location: '/es/blog/x', id: 'rd_1' });
    expect(await edgeRedirect('amplify', '/docs/api/x', '', ok, '/es')).toMatchObject({ location: 'https://api.example.com/x' });
    // A change reloads the table; a failed reload keeps the last good one (a slow API never drops the redirects).
    forgetRedirects('amplify');
    const down = vi.fn(() => Promise.reject(new Error('down')));
    expect(await edgeRedirect('amplify', '/a', '', down)).toMatchObject({ location: '/c?x=1', id: 'rd_5' });
    expect(down).toHaveBeenCalledTimes(1);
    expect(await edgeRedirect('beta', '/a', '', down)).toBeNull();
    forgetRedirects();
  });

  it('serves a stale table while it refreshes in the background', async () => {
    vi.useFakeTimers();
    try {
      const { edgeRedirect, forgetRedirects } = await import('./redirects');
      forgetRedirects();
      const first = vi.fn(() =>
        Promise.resolve(Response.json({ data: [{ id: 'rd_1', from: '/a', to: '/b', status: 301, keep_query: true }] })),
      );
      expect(await edgeRedirect('amplify', '/a', '', first)).toMatchObject({ location: '/b' });
      vi.advanceTimersByTime(61_000);
      let release: (r: Response) => void = () => undefined;
      const slow = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
      // Stale: answered at once from the old table while the refresh runs.
      expect(await edgeRedirect('amplify', '/a', '', slow)).toMatchObject({ location: '/b' });
      expect(slow).toHaveBeenCalledTimes(1);
      release(Response.json({ data: [{ id: 'rd_1', from: '/a', to: '/c', status: 301, keep_query: true }] }));
      await vi.waitFor(async () => expect(await edgeRedirect('amplify', '/a', '', slow)).toMatchObject({ location: '/c' }));
      forgetRedirects();
    } finally {
      vi.useRealTimers();
    }
  });

  it('indexes the table: the same answers as a scan, longest prefix first', () => {
    const table = indexRedirects(rules);
    for (const path of [
      '/old-blog/My-Post/',
      '/OLD-BLOG/special?ref=x',
      '/old-blog',
      '/old-blogger',
      '/docs/api/v1/users',
      '/docs/start/here',
      '/a',
    ])
      expect(matchRedirect(table, path)).toEqual(matchRedirect([...rules], path));
    expect(resolveRedirect(table, '/a')).toMatchObject({ to: '/c?x=1', status: 302 });
  });
});

describe('404 monitor reports (server-side)', () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it('tells an in-app visit from an outside one by what the server saw, never by the browser', () => {
    // A client-side navigation or router prefetch: only this site's own JavaScript sends `RSC: 1`.
    expect(visitOf(h({ rsc: '1', referer: 'https://evil.example/' }), 'school.example')).toEqual({ internal: true, referrer: null });
    // A document load from one of the site's pages, or from another site.
    expect(visitOf(h({ referer: 'https://School.example/courses' }), 'school.example')).toEqual({ internal: true, referrer: null });
    expect(visitOf(h({ referer: 'https://www.google.com/search?q=x' }), 'school.example')).toEqual({
      internal: false,
      referrer: 'https://www.google.com/search?q=x',
    });
    expect(visitOf(h({}), 'school.example')).toEqual({ internal: false, referrer: null });
    expect(visitOf(h({ referer: 'not a url' }), 'school.example')).toEqual({ internal: false, referrer: null });
  });

  it('keeps a noted visit for its own visitor and path, once, for a few minutes', () => {
    forgetVisits();
    const me = visitorOf('203.0.113.7', 'Safari');
    noteVisit('amp', me, '/old-link', { internal: true, referrer: null }, 1_000);
    expect(takeVisit('amp', visitorOf('203.0.113.8', 'Safari'), '/old-link', 2_000)).toBeNull();
    expect(takeVisit('other', me, '/old-link', 2_000)).toBeNull();
    expect(takeVisit('amp', me, '/old-link', 2_000)).toEqual({ internal: true, referrer: null });
    expect(takeVisit('amp', me, '/old-link', 2_000)).toBeNull();
    noteVisit('amp', me, '/gone', { internal: false, referrer: null }, 1_000);
    expect(takeVisit('amp', me, '/gone', 1_000 + 6 * 60_000)).toBeNull();
    forgetVisits();
  });

  it('accepts only same-origin requests and plain site paths', () => {
    expect(isSameOrigin(h({ 'sec-fetch-site': 'same-origin' }), 'school.example')).toBe(true);
    expect(isSameOrigin(h({ 'sec-fetch-site': 'cross-site', origin: 'https://school.example' }), 'school.example')).toBe(false);
    expect(isSameOrigin(h({ origin: 'https://school.example' }), 'school.example')).toBe(true);
    expect(isSameOrigin(h({ origin: 'https://evil.example' }), 'school.example')).toBe(false);
    expect(isSameOrigin(h({}), 'school.example')).toBe(false);
    expect(reportablePath('/old-link')).toBe('/old-link');
    expect(reportablePath('//evil.example')).toBeNull();
    expect(reportablePath('/preview/abc')).toBeNull();
    expect(reportablePath('x')).toBeNull();
    expect(reportablePath(42)).toBeNull();
  });

  it('reports with the service token what the server saw, and never throws', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as unknown as typeof fetch;
    const base = {
      apiUrl: 'http://api.test',
      serviceToken: 'svc',
      tenant: 'amp',
      path: '/old',
      visitorIp: '203.0.113.7',
      userAgent: 'Safari',
    };
    await reportNotFound({ ...base, visit: { internal: false, referrer: 'https://www.google.com/' } }, ok);
    await reportNotFound({ ...base, visit: null }, ok);
    expect(calls[0]!.url).toBe('http://api.test/api/v1/seo/not-found');
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer svc', 'X-Tenant': 'amp' });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      path: '/old',
      visitor_ip: '203.0.113.7',
      user_agent: 'Safari',
      internal: false,
      referrer: 'https://www.google.com/',
    });
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({
      path: '/old',
      visitor_ip: '203.0.113.7',
      user_agent: 'Safari',
      internal: false,
    });
    const failing = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
    await expect(reportNotFound({ ...base, visit: null }, failing)).resolves.toBeUndefined();
  });
});

describe('robots.txt', () => {
  const build = (rules: string, indexable = true) =>
    buildRobots({ indexable, rules, privatePaths: [...NOINDEX_PREFIXES, '/api/'], sitemapUrl: 'https://school.example/sitemap.xml' });

  it('adds the private Disallows to every group the school writes and drops Allows that would open them', () => {
    const out = build(
      'User-agent: *\nDisallow: /drafts\n\nUser-agent: Googlebot\nAllow: /account/settings\nAllow: /\nDisallow: /tmp\nNoindex: /x\nSitemap: https://evil.example/s.xml',
    );
    const groups = out.split('\n\n');
    expect(groups[0]).toMatch(/^User-agent: \*\nDisallow: \/drafts\nDisallow: \/learning/);
    expect(groups[1]).toContain('User-agent: Googlebot');
    expect(groups[1]).toContain('Disallow: /checkout');
    expect(groups[1]).toContain('Allow: /');
    expect(out).not.toContain('Allow: /account/settings');
    expect(out).not.toContain('Noindex');
    expect(out).not.toContain('evil.example');
    expect(out.trimEnd().endsWith('Sitemap: https://school.example/sitemap.xml')).toBe(true);
  });

  it('always has a * group, and blocks everything for a hidden site', () => {
    expect(build('User-agent: Bingbot\nDisallow: /x')).toContain('User-agent: *\nAllow: /\nDisallow: /learning');
    expect(build('anything', false)).toBe('User-agent: *\nDisallow: /\n');
    expect(opensPrivate('/check*', NOINDEX_PREFIXES)).toBe(false);
    expect(opensPrivate('/checkout*', NOINDEX_PREFIXES)).toBe(true);
  });

  it('closes a private path and what is under it, never a page with a longer name', () => {
    const out = build('User-agent: *\nAllow: /accounting\nAllow: /learner-stories\nAllow: /account/x');
    expect(out).toContain('Disallow: /account$\nDisallow: /account/');
    expect(out).not.toMatch(/Disallow: \/account\n/);
    expect(out).toContain('Allow: /accounting');
    expect(out).toContain('Allow: /learner-stories');
    expect(out).not.toContain('Allow: /account/x');
    expect(opensPrivate('/community-guidelines', NOINDEX_PREFIXES)).toBe(false);
    expect(opensPrivate('/community', NOINDEX_PREFIXES)).toBe(true);
  });
});

describe('storefront SEO settings', () => {
  it('normalises any API version, finds per-page overrides and the unlisted paths', () => {
    expect(normalizeSeo(null)).toEqual(DEFAULT_SEO);
    const seo = normalizeSeo({
      titleTemplate: '{page} | {school}',
      schemaTypes: { faq: false } as never,
      pages: [
        {
          path: '/Courses/X/',
          title: 'X — the course',
          description: null,
          noindex: true,
          inSitemap: true,
          canonicalUrl: null,
          ogImageUrl: null,
        },
        { path: '/', title: null, description: 'Home', noindex: false, inSitemap: false, canonicalUrl: null, ogImageUrl: null },
      ],
    });
    expect(seo.schemaTypes).toMatchObject({ faq: false, course: true });
    expect(schemaAllowed(seo, 'faq')).toBe(false);
    expect(schemaAllowed({ ...seo, schemaEnabled: false }, 'course')).toBe(false);
    expect(overrideFor(seo, '/courses/x')?.title).toBe('X — the course');
    expect(overrideFor(seo, '/home')?.description).toBe('Home');
    expect([...unlisted(seo)]).toEqual(['/courses/x', '/']);
    expect(titleTemplate('{page} — {school}', 'Acme %s')).toBe('%s — Acme % s');
  });

  it('classifies JSON-LD by type and escapes it so it can’t break out of its script tag', () => {
    expect(schemaTypeOf('BlogPosting')).toBe('article');
    expect(schemaTypeOf('ProfilePage')).toBe('person');
    expect(schemaTypeOf('Thing')).toBeNull();
    const LS = String.fromCharCode(0x2028);
    const text = jsonLdText({ name: `</script><script>alert(1)</script> & ${LS}` });
    expect(['<', '>', '&', LS].some((c) => text.includes(c))).toBe(false);
    expect(JSON.parse(text)).toEqual({ name: `</script><script>alert(1)</script> & ${LS}` });
  });

  it('builds valid Course offers (free courses are Free) and BlogPosting', () => {
    const site = { name: 'Acme', seo: { description: '' }, social: [] } as unknown as Site;
    const course = {
      slug: 'c',
      title: 'C',
      excerpt: 'e',
      price: { amount: 0, currency: 'USD' },
      reviewCount: 0,
      durationMinutes: 90,
      instructor: { name: 'I', slug: null },
      level: 'beginner',
      outcomes: [],
      reviews: [],
      description: '',
    } as never;
    const ld = JSON.parse(jsonLdText(courseJsonLd(site, 'https://a.example', 'en', course))) as {
      offers: { category: string; price: string };
    };
    expect(ld.offers).toMatchObject({ category: 'Free', price: '0.00' });
    const post = {
      slug: 'p',
      title: 'P',
      excerpt: 'x',
      seo: { title: 'P — SEO', description: 'd' },
      publishedAt: '2026-10-01T00:00:00Z',
      categories: ['News'],
      readMinutes: 4,
      author: { name: 'Maya' },
    } as BlogPost;
    expect(blogPostingJsonLd(site, 'https://a.example', 'https://a.example', post)).toMatchObject({
      '@type': 'BlogPosting',
      headline: 'P — SEO',
      timeRequired: 'PT4M',
      author: { '@type': 'Person', name: 'Maya' },
    });
  });
});
