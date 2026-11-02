import type { CourseDetail } from '@/features/catalog/types';
import { camelize, snakeize } from './api/case';
import { formatBytes, formatClock, formatMoney, stars, timeAgo } from './format';
import { isPrivatePath, routes } from './routes';
import { parseAttributes, parseHeadCode, reactProps } from './headCode';
import { breadcrumbJsonLd, metaDescription, siteIcons, siteOpenGraph } from './seo';
import { brandCss, brandTokens, oklchToHex } from './theme';

describe('case conversion (wire format)', () => {
  it('converts nested keys both ways without touching values', () => {
    const wire = { student_count: 3, cover: { url: null, alt_text: 'x_y' }, items: [{ course_slug: 'a_b' }] };
    const code = camelize<{ studentCount: number; cover: { altText: string }; items: { courseSlug: string }[] }>(wire);
    expect(code.studentCount).toBe(3);
    expect(code.cover.altText).toBe('x_y');
    expect(code.items[0]!.courseSlug).toBe('a_b');
    expect(snakeize(code)).toEqual(wire);
  });

  it('maps a course outline lesson, its summary (string or null) included', () => {
    const wire = {
      modules: [
        {
          id: 'm1',
          title: 'Start',
          lessons: [
            {
              id: 'l1',
              title: 'Intro',
              type: 'video',
              duration_seconds: 60,
              question_count: null,
              free_preview: true,
              summary: 'Why it_matters.',
            },
            { id: 'l2', title: 'Notes', type: 'text', duration_seconds: null, question_count: null, free_preview: false, summary: null },
          ],
        },
      ],
    };
    const { modules } = camelize<Pick<CourseDetail, 'modules'>>(wire);
    expect(modules[0]!.lessons.map((l) => [l.freePreview, l.summary])).toEqual([
      [true, 'Why it_matters.'],
      [false, null],
    ]);
  });
});

describe('formatting', () => {
  it('drops decimals for whole amounts and keeps them otherwise', () => {
    expect(formatMoney({ amount: 24900, currency: 'USD' }, 'en-US')).toBe('$249');
    expect(formatMoney({ amount: 129950, currency: 'USD' }, 'en-US')).toBe('$1,299.50');
    expect(formatMoney({ amount: 8900, currency: 'GBP' }, 'en-GB')).toBe('£89');
  });
  it('formats lesson clocks, sizes and stars', () => {
    expect(formatClock(252)).toBe('4:12');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatBytes(1_258_291, 'en-US')).toBe('1.2 MB');
    expect(stars(4)).toBe('★★★★☆');
  });
  it('formats relative time in the given locale', () => {
    const now = Date.parse('2026-09-26T12:00:00Z');
    expect(timeAgo('2026-09-26T10:00:00Z', 'en-US', now)).toBe('2h ago');
  });
});

describe('routes', () => {
  it('only accepts same-origin paths as a post-login destination', () => {
    expect(routes.signIn('/learning')).toBe('/sign-in?next=%2Flearning');
    expect(routes.signIn('//evil.example')).toBe('/sign-in');
    expect(routes.signIn('https://evil.example')).toBe('/sign-in');
  });
  it('knows which paths need a signed-in learner', () => {
    expect(isPrivatePath('/learning')).toBe(true);
    expect(isPrivatePath('/learn/course-a/les_1')).toBe(true);
    expect(isPrivatePath('/checkout')).toBe(true);
    expect(isPrivatePath('/courses')).toBe(false);
    expect(isPrivatePath('/learnings-blog')).toBe(false);
  });
});

describe('theme', () => {
  it('derives brand tokens from hue/chroma like the design', () => {
    const t = brandTokens({ hue: 275, chroma: 0.2 });
    expect(t['--brand']).toBe('oklch(0.51 0.190 275)');
    expect(t['--brand-tint']).toBe('oklch(0.95 0.032 275)');
  });
  it('cannot be used to inject CSS', () => {
    const css = brandCss({ hue: '275;}</style><script>' as unknown as number, chroma: 0.2 });
    expect(css).not.toMatch(/<|script|\}.*\{/);
  });
  it('converts OKLCH to sRGB hex for image rendering', () => {
    expect(oklchToHex(1, 0, 0)).toBe('#ffffff');
    expect(oklchToHex(0, 0, 0)).toBe('#000000');
    expect(oklchToHex(0.51, 0.19, 275)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('seo', () => {
  it('trims meta descriptions on a word boundary', () => {
    const long = 'word '.repeat(60);
    const d = metaDescription(long);
    expect(d.length).toBeLessThanOrEqual(161);
    expect(d.endsWith('…')).toBe(true);
  });
  it('builds absolute breadcrumb URLs', () => {
    const b = breadcrumbJsonLd('https://learn.example.com', [
      { name: 'Home', path: '/' },
      { name: 'Courses', path: '/courses' },
    ]);
    expect(b.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://learn.example.com' },
      { '@type': 'ListItem', position: 2, name: 'Courses', item: 'https://learn.example.com/courses' },
    ]);
  });
  it('picks the favicon: site builder favicon → Branding icon → logo → generated PNG tile', () => {
    const none = { faviconUrl: null, iconUrl: null, logoUrl: null };
    expect(siteIcons(none)).toEqual({ icon: [{ url: '/icon.png', type: 'image/png' }], apple: '/icon.png' });
    expect(siteIcons({ ...none, logoUrl: '/logo.webp' })).toEqual({ icon: [{ url: '/logo.webp' }], apple: '/logo.webp' });
    expect(siteIcons({ ...none, logoUrl: '/logo.webp', iconUrl: '/icon.jpg' })).toEqual({
      icon: [{ url: '/icon.jpg' }],
      apple: '/icon.jpg',
    });
    expect(siteIcons({ faviconUrl: '/fav.ico', iconUrl: '/icon.jpg', logoUrl: '/logo.webp' })).toEqual({
      icon: [{ url: '/fav.ico' }],
      apple: '/icon.jpg',
    });
  });
});

describe('school head code', () => {
  it('keeps head elements verbatim and drops comments, <base> and anything else', () => {
    const code = [
      '<!-- analytics -->',
      '<meta name="google-site-verification" content="abc">',
      '<link rel="preconnect" href="https://cdn.example" crossorigin>',
      '<script async src="https://cdn.example/a.js"></script>',
      '<script>window.x = "<b>";</script>',
      '<style>.x{color:red}</style>',
      '<base href="https://evil.example/">',
      '<div>not a head element</div>',
    ].join('\n');
    const els = parseHeadCode(code);
    expect(els.map((e) => e.tag)).toEqual(['meta', 'link', 'script', 'script', 'style']);
    expect(els[0]!.attrs).toEqual({ name: 'google-site-verification', content: 'abc' });
    expect(els[3]!.content).toBe('window.x = "<b>";');
    expect(reactProps(els[1]!.attrs)).toEqual({ rel: 'preconnect', href: 'https://cdn.example', crossOrigin: '' });
    expect(reactProps(els[2]!.attrs)).toEqual({ async: true, src: 'https://cdn.example/a.js' });
  });
  it('drops inline event handlers', () => {
    expect(parseAttributes(`src="x.js" onload='alert(1)' data-id=7`)).toEqual({ src: 'x.js', 'data-id': '7' });
  });
});

describe('Open Graph', () => {
  const site = {
    name: 'Amplify',
    locales: ['en-US', 'es-ES'],
    seo: { ogImageUrl: 'https://cdn.example/share.png' },
  } as unknown as Parameters<typeof siteOpenGraph>[0];
  it('carries the site-wide fields every page must keep (pages replace the whole object)', () => {
    expect(siteOpenGraph(site, 'en-US')).toEqual({
      siteName: 'Amplify',
      type: 'website',
      locale: 'en_US',
      alternateLocale: ['es_ES'],
      images: [{ url: 'https://cdn.example/share.png', width: 1200, height: 630 }],
    });
    expect(siteOpenGraph(site, 'en-US', 'https://cdn.example/page.png').images).toEqual([
      { url: 'https://cdn.example/page.png', width: 1200, height: 630 },
    ]);
  });
});
