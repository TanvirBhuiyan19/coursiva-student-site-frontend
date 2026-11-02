import { acquisitionFrom, captureAcquisition, storedAcquisition } from './analytics/acquisition';
import { clientIp, isPageView, pageViewPath, pageViewReferrer, reportPageView } from './analytics/pageviews';
import { filterCourses } from './catalog/components/CatalogBrowser';
import type { CourseSummary } from './catalog/types';
import { referralFrom, rememberPostIn } from './analytics/referral';
import { elementsAmount, needsPayment, offeredMethods } from './commerce/payments';
import { eventIcs } from './learning/calendar';
import { PlayedRanges, detectDevice, joinTouching } from './learning/playback';

const course = (slug: string, cat: string, students: number, rating: number, price: number): CourseSummary =>
  ({
    id: slug,
    slug,
    title: slug.replace(/-/g, ' '),
    category: { slug: cat, name: cat[0]!.toUpperCase() + cat.slice(1) },
    studentCount: students,
    rating,
    price: { amount: price, currency: 'USD' },
  }) as CourseSummary;

describe('catalogue filtering', () => {
  const courses = [
    course('funnel-blueprint', 'marketing', 486, 4.9, 24900),
    course('pricing', 'sales', 54, 4.7, 9900),
    course('email', 'marketing', 342, 4.8, 19900),
  ];
  it('filters by category and search, then sorts', () => {
    expect(filterCourses(courses, { q: '', category: 'marketing', sort: 'popular' }).map((c) => c.slug)).toEqual([
      'funnel-blueprint',
      'email',
    ]);
    expect(filterCourses(courses, { q: 'SALES', category: '', sort: 'popular' }).map((c) => c.slug)).toEqual(['pricing']);
    expect(filterCourses(courses, { q: '', category: '', sort: 'price_asc' }).map((c) => c.slug)).toEqual([
      'pricing',
      'email',
      'funnel-blueprint',
    ]);
  });
});

describe('payment boundary', () => {
  const usd = (amount: number) => ({ amount, currency: 'USD' });
  // A subscription (a membership or a subscription course) is a quote with `recurring`.
  const monthly = { interval: 'month', amount: usd(3500), trialDays: 0 } as const;
  it('skips the payment step for free or gift-card-covered orders, but a subscription still saves a card', () => {
    expect(needsPayment({ payToday: usd(0), recurring: null })).toBe(false);
    expect(needsPayment({ payToday: usd(4900), recurring: null })).toBe(true);
    expect(needsPayment({ payToday: usd(0), recurring: monthly })).toBe(true);
  });
  it('matches the Elements options to what the API confirms', () => {
    expect(elementsAmount({ payToday: usd(4900), installments: null, recurring: null })).toEqual({
      mode: 'payment',
      amount: 4900,
      currency: 'usd',
      saveCard: false,
    });
    expect(elementsAmount({ payToday: usd(1700), installments: { count: 3, amount: usd(1700) }, recurring: null }).saveCard).toBe(true);
    expect(elementsAmount({ payToday: usd(0), installments: null, recurring: monthly })).toMatchObject({ mode: 'setup', saveCard: true });
    expect(elementsAmount({ payToday: usd(3500), installments: null, recurring: monthly })).toMatchObject({
      mode: 'payment',
      saveCard: true,
    });
    // A gift card pays part: the card is charged the rest.
    expect(elementsAmount({ payToday: usd(2400), installments: null, recurring: null })).toMatchObject({ mode: 'payment', amount: 2400 });
  });
  it('offers only what the gateway takes, card first', () => {
    expect(offeredMethods({ provider: 'stripe', publishableKey: 'pk_test_x', stripeAccount: 'acct_x', methods: ['card'] })).toEqual([
      'card',
    ]);
    expect(offeredMethods({ provider: 'test', publishableKey: null, stripeAccount: null, methods: ['paypal', 'card', 'bnpl'] })).toEqual([
      'card',
      'paypal',
      'bnpl',
    ]);
    expect(offeredMethods(undefined)).toEqual(['card']);
  });
});

describe('affiliate and blog attribution', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };
  it('remembers the last blog post read', () => {
    const local = memory();
    rememberPostIn(local, 'first-post', 1);
    rememberPostIn(local, 'second-post', 2);
    expect(referralFrom(local, 3).post).toBe('second-post');
  });
});

describe('calendar invite', () => {
  it('produces a valid VEVENT with join link and reminder', () => {
    const ics = eventIcs(
      {
        id: 'evt_1',
        title: 'Live Q&A, with Maya',
        startsAt: '2026-10-01T21:00:00.000Z',
        provider: 'zoom',
        attendees: 1,
        going: true,
        joinUrl: 'https://zoom.us/j/1',
      },
      { name: 'Amplify', email: 'help@amplify.example.com' },
    );
    expect(ics).toContain('ORGANIZER;CN=Amplify:mailto:help@amplify.example.com');
    expect(ics).not.toContain('coursiva');
    expect(ics).toContain('DTSTART:20261001T210000Z');
    expect(ics).toContain('DTEND:20261001T220000Z');
    expect(ics).toContain('SUMMARY:Live Q&A\\, with Maya');
    expect(ics).toContain('URL:https://zoom.us/j/1');
    expect(ics).toContain('TRIGGER:-PT15M');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
});

describe('server-side page views (proxy)', () => {
  const h = (init: Record<string, string>) => new Headers(init);
  const doc = { 'sec-fetch-dest': 'document', accept: 'text/html,application/xhtml+xml' };

  it('reports document loads and client navigations', () => {
    expect(isPageView('GET', '/courses/funnels-101', h(doc))).toBe(true);
    expect(isPageView('GET', '/', h({ accept: 'text/html' }))).toBe(true); // no Sec-Fetch-* (older browsers, curl)
    expect(isPageView('GET', '/courses', h({ rsc: '1', accept: '*/*' }))).toBe(true);
  });
  it('skips prefetches, non-GETs, assets, API calls and sub-resources', () => {
    expect(isPageView('GET', '/courses', h({ rsc: '1', 'next-router-prefetch': '1' }))).toBe(false);
    expect(isPageView('GET', '/courses', h({ rsc: '1', 'next-router-segment-prefetch': '/_tree' }))).toBe(false);
    expect(isPageView('GET', '/courses', h({ ...doc, purpose: 'prefetch' }))).toBe(false);
    expect(isPageView('GET', '/courses', h({ ...doc, 'sec-purpose': 'prefetch;prerender' }))).toBe(false);
    expect(isPageView('POST', '/checkout', h(doc))).toBe(false);
    expect(isPageView('HEAD', '/', h(doc))).toBe(false);
    for (const p of ['/api/v1/site', '/sanctum/csrf-cookie', '/_next/data/x.json', '/hooks/revalidate', '/favicon.ico', '/img/a.png'])
      expect(isPageView('GET', p, h(doc))).toBe(false);
    expect(isPageView('GET', '/courses', h({ 'sec-fetch-dest': 'iframe', accept: 'text/html' }))).toBe(false);
    expect(isPageView('GET', '/courses', h({ 'sec-fetch-dest': 'empty', accept: 'application/json' }))).toBe(false);
    expect(isPageView('GET', '/courses', h({ accept: 'application/json' }))).toBe(false);
  });
  it('reports the locale-less path with its query, minus the RSC cache-buster', () => {
    expect(pageViewPath('/courses/funnels-101', '')).toBe('/courses/funnels-101');
    expect(pageViewPath('/checkout', '?course=x&_rsc=1abc')).toBe('/checkout?course=x');
    expect(pageViewPath('', '')).toBe('/');
    expect(pageViewPath(`/${'a'.repeat(2100)}`, '')).toBeNull();
  });
  it('takes the client IP from the first forwarded hop, else X-Real-IP, and only valid IPs', () => {
    expect(clientIp(h({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(clientIp(h({ 'x-forwarded-for': '203.0.113.7:51234' }))).toBe('203.0.113.7');
    expect(clientIp(h({ 'x-forwarded-for': '[2001:db8::1]:443' }))).toBe('2001:db8::1');
    expect(clientIp(h({ 'x-forwarded-for': 'unknown', 'x-real-ip': '2001:db8::2' }))).toBe('2001:db8::2');
    expect(clientIp(h({ 'x-forwarded-for': '999.1.1.1' }))).toBeNull();
    expect(clientIp(h({ 'x-real-ip': 'not-an-ip' }))).toBeNull();
    expect(clientIp(h({}))).toBeNull();
  });
  it('sends only an external referrer, and never for client navigations', () => {
    const own = 'amplify.coursiva.app';
    expect(pageViewReferrer(h({ referer: 'https://www.google.com/search?q=funnels' }), own)).toBe(
      'https://www.google.com/search?q=funnels',
    );
    expect(pageViewReferrer(h({ referer: 'android-app://com.google.android.gm/' }), own)).toBe('android-app://com.google.android.gm/');
    expect(pageViewReferrer(h({ referer: 'https://amplify.coursiva.app/courses' }), own)).toBeNull();
    expect(pageViewReferrer(h({ referer: 'https://AMPLIFY.coursiva.app:443/courses' }), own)).toBeNull();
    expect(pageViewReferrer(h({ rsc: '1', referer: 'https://www.google.com/' }), own)).toBeNull();
    expect(pageViewReferrer(h({}), own)).toBeNull();
    expect(pageViewReferrer(h({ referer: 'not a url' }), own)).toBeNull();
    expect(pageViewReferrer(h({ referer: `https://news.example/${'a'.repeat(2100)}` }), own)).toHaveLength(2000);
  });
  it('posts the report with the service token and swallows failures', async () => {
    const calls: [string, RequestInit][] = [];
    const ok = ((url: string, init: RequestInit) => {
      calls.push([url, init]);
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as unknown as typeof fetch;
    const report = {
      apiUrl: 'http://api',
      serviceToken: 'tok',
      tenant: 'amplify',
      path: '/courses',
      visitorIp: '203.0.113.7',
      userAgent: 'x'.repeat(600),
    };
    await reportPageView(report, ok);
    const [url, init] = calls[0]!;
    expect(url).toBe('http://api/api/v1/analytics/pageviews');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'X-Tenant': 'amplify' });
    const sent = JSON.parse(init.body as string) as { path: string; visitor_ip: string; user_agent: string };
    expect(sent).toMatchObject({ path: '/courses', visitor_ip: '203.0.113.7' });
    expect(sent.user_agent).toHaveLength(500);
    expect(sent).not.toHaveProperty('referrer');
    await reportPageView({ ...report, referrer: 'https://www.google.com/' }, ok);
    expect(JSON.parse(calls[1]![1].body as string)).toMatchObject({ referrer: 'https://www.google.com/' });
    const failing = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
    await expect(reportPageView(report, failing)).resolves.toBeUndefined();
  });
});

describe('first-touch acquisition', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
    };
  };

  it('keeps UTM tags, ad click ids and only an external referrer origin', () => {
    const landing =
      'https://amplify.coursiva.app/courses/x?utm_source=newsletter&utm_medium=email&utm_campaign=%20spring%20&gclid=G1&utm_term=no&ref=no';
    expect(acquisitionFrom(landing, 'https://www.google.com/search?q=x')).toEqual({
      utmSource: 'newsletter',
      utmMedium: 'email',
      utmCampaign: 'spring',
      gclid: 'G1',
      referrer: 'https://www.google.com',
    });
    const clicks = 'https://a.test/?fbclid=F&ttclid=T&li_fat_id=L&msclkid=M&epik=E&twclid=X&wbraid=no';
    expect(acquisitionFrom(clicks, '')).toEqual({
      fbclid: 'F',
      ttclid: 'T',
      liFatId: 'L',
      msclkid: 'M',
      epik: 'E',
      twclid: 'X',
    });
    expect(acquisitionFrom(`https://a.test/?utm_campaign=${'c'.repeat(150)}`, '').utmCampaign).toHaveLength(100);
    expect(acquisitionFrom(`https://a.test/?fbclid=${'f'.repeat(600)}`, '').fbclid).toHaveLength(500);
    expect(acquisitionFrom(`https://a.test/?gclid=${'g'.repeat(300)}`, '').gclid).toHaveLength(200);
    expect(acquisitionFrom(`https://a.test/?li_fat_id=${'l'.repeat(300)}`, '').liFatId).toHaveLength(200);
    expect(acquisitionFrom('https://amplify.coursiva.app/', 'https://amplify.coursiva.app/courses')).toEqual({});
    expect(acquisitionFrom('https://amplify.coursiva.app/', '')).toEqual({});
    expect(acquisitionFrom('https://amplify.coursiva.app/', 'android-app://com.google.android.gm/')).toEqual({});
    expect(acquisitionFrom(`https://a.test/?utm_source=${'s'.repeat(150)}`, '').utmSource).toHaveLength(100);
  });
  it('lets the first touch win, even an empty one', () => {
    const store = memory();
    captureAcquisition(store, 'https://a.test/?utm_source=youtube', 'https://www.youtube.com/watch?v=1');
    captureAcquisition(store, 'https://a.test/?utm_source=instagram', 'https://instagram.com/');
    expect(storedAcquisition(store)).toEqual({ utmSource: 'youtube', referrer: 'https://www.youtube.com' });

    const direct = memory();
    captureAcquisition(direct, 'https://a.test/', '');
    captureAcquisition(direct, 'https://a.test/?utm_source=later', '');
    expect(storedAcquisition(direct)).toBeNull();
  });
  it('survives blocked or tampered storage', () => {
    const blocked = {
      getItem: (): string | null => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(() => {
      captureAcquisition(blocked, 'https://a.test/?utm_source=x', '');
    }).not.toThrow();
    expect(storedAcquisition(blocked)).toBeNull();
    const tampered = memory();
    tampered.setItem(
      'coursiva:acquisition',
      JSON.stringify({ utmSource: 'x', email: 'a@b.c', gclid: 42, msclkid: 'm'.repeat(300), utmCampaign: 'c' }),
    );
    expect(storedAcquisition(tampered)).toEqual({ utmSource: 'x', utmCampaign: 'c', msclkid: 'm'.repeat(200) });
    tampered.setItem('coursiva:acquisition', '{oops');
    expect(storedAcquisition(tampered)).toBeNull();
  });
});

describe('video playback ranges', () => {
  it('records a continuous play and closes it on pause', () => {
    const r = new PlayedRanges();
    r.start(0);
    for (let t = 0.25; t <= 10; t += 0.25) r.tick(t);
    r.stop(10.1);
    expect(r.take()).toEqual([[0, 10.1]]);
    expect(r.take()).toEqual([]);
  });
  it('splits on seeks (seen or not) and keeps re-played ranges as separate segments', () => {
    const r = new PlayedRanges();
    r.start(0);
    r.tick(2.5);
    r.tick(5);
    r.stop(); // seeking: currentTime is already the target, so close at the last position seen
    r.start(2); // seeked back
    r.tick(4);
    r.tick(60); // jump without seek events
    r.tick(61);
    r.tick(62);
    r.stop(62);
    expect(r.take()).toEqual([
      [0, 5],
      [2, 4],
      [60, 62],
    ]);
  });
  it('cuts the open range at the playhead on a periodic flush and continues from there', () => {
    const r = new PlayedRanges();
    r.start(30);
    r.tick(37.5);
    r.tick(44.9);
    expect(r.take(45)).toEqual([[30, 45]]);
    r.tick(50);
    r.stop(50);
    expect(r.take()).toEqual([[45, 50]]);
  });
  it('joins touching segments, drops empty ones and caps a report at 50', () => {
    expect(
      joinTouching([
        [0, 5],
        [5, 9],
        [3, 4],
      ]),
    ).toEqual([
      [0, 9],
      [3, 4],
    ]);
    const r = new PlayedRanges();
    r.start(7);
    r.stop(7);
    expect(r.take()).toEqual([]);
    for (let i = 0; i < 60; i++) {
      r.start(i * 10);
      r.tick(i * 10 + 1);
      r.stop(i * 10 + 1);
    }
    const out = r.take();
    expect(out).toHaveLength(50);
    expect(out.at(-1)).toEqual([590, 591]);
  });
  it('tells tablets from desktops', () => {
    expect(detectDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5, 820)).toBe('tablet');
    expect(detectDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 5, 820)).toBe('tablet'); // iPadOS
    expect(detectDevice('Mozilla/5.0 (Linux; Android 14; SM-X710) Chrome Safari', 10, 800)).toBe('tablet');
    expect(detectDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome Mobile Safari', 5, 412)).toBe('web');
    expect(detectDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 0, 900)).toBe('web');
    expect(detectDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome', 0, 1080)).toBe('web');
  });
});
