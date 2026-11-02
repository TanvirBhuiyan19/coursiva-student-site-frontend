// @vitest-environment jsdom
// Tracking tags and conversion events (docs/consent.md → Tracking tags): validated ids only, consent first, one
// purchase per order, and the server-side signal limited to what the visitor allows.
import { render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resetConsentForTests, saveChoice } from '@/features/consent/store';
import { configureConsent, conversionSignal, resetTrackingForTests } from '@/features/consent/tracking';
import { normalizeSite } from '@/features/tenant/normalize';
import { applyTracking, eventIdOf, major, resetEventsForTests, trackEvent, trackPageView } from './events';
import { hasTags, NO_TRACKING, normalizeTracking, type SiteTracking } from './ids';
import { purchaseItems } from './TrackPurchase';
import { resetTagsForTests, tagWindow } from './tags';
import { VerificationMeta } from './VerificationMeta';

const ALL: SiteTracking = {
  ga4: 'G-ABCD1234',
  gtm: 'GTM-ABC1234',
  metaPixel: '123456789012345',
  tiktokPixel: 'C4A1B2C3D4E5F6G7H8I9',
  linkedinPartner: '1234567',
  clarity: 'abc123xyz',
  yandexMetrica: '12345678',
  verification: { google: 'Ab_Cd-1234567890', bing: '0123456789ABCDEF', yandex: null, pinterest: null },
};

const scripts = () => [...document.head.querySelectorAll('script[data-coursiva-tracking]')].map((s) => (s as HTMLScriptElement).src);
type Calls = { dataLayer: unknown[]; fbq: unknown[][]; ttq: unknown[] };
const calls = (): Calls => {
  const w = tagWindow();
  return {
    dataLayer: (w.dataLayer ?? []).map((a) => (a && typeof a === 'object' && 'length' in a ? Array.from(a as ArrayLike<unknown>) : a)),
    fbq: (w.fbq?.queue as unknown[][] | undefined) ?? [],
    ttq: [...((w.ttq as unknown[] | undefined) ?? [])],
  };
};

beforeEach(() => {
  resetConsentForTests();
  resetTrackingForTests();
  resetTagsForTests();
  resetEventsForTests();
  localStorage.clear();
  sessionStorage.clear();
  document.head.querySelectorAll('script').forEach((n) => n.remove());
  const w = tagWindow() as unknown as Record<string, unknown>;
  for (const k of [
    'dataLayer',
    'gtag',
    'fbq',
    '_fbq',
    'ttq',
    'clarity',
    'ym',
    'lintrk',
    '_linkedin_partner_id',
    '_linkedin_data_partner_ids',
  ])
    Reflect.deleteProperty(w, k);
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
  }
});

describe('ids', () => {
  it('keeps only ids in their strict formats', () => {
    expect(
      normalizeTracking({
        ...ALL,
        metaPixel: '123"><script>',
        gtm: "GTM-ABC');alert(1)//",
        verification: { google: 'x"/><script>', bing: 'ok' },
      }),
    ).toEqual({
      ...ALL,
      metaPixel: null,
      gtm: null,
      verification: { google: null, bing: null, yandex: null, pinterest: null },
    });
    expect(normalizeTracking(undefined)).toEqual(NO_TRACKING);
    expect(hasTags(NO_TRACKING)).toBe(false);
    expect(hasTags(ALL)).toBe(true);
    // An older API (no `tracking`) still renders: no tags.
    expect(normalizeSite({ name: 'X' }).tracking).toEqual(NO_TRACKING);
  });

  it('renders verification tags on the server', () => {
    const html = renderToStaticMarkup(<VerificationMeta tracking={ALL} />);
    expect(html).toBe(
      '<meta name="google-site-verification" content="Ab_Cd-1234567890"/><meta name="msvalidate.01" content="0123456789ABCDEF"/>',
    );
  });
});

describe('tags', () => {
  it('loads nothing before the visitor allows a category, then only that category', () => {
    configureConsent({ required: true });
    applyTracking(ALL, { analytics: false, marketing: false });
    expect(scripts()).toEqual([]);

    saveChoice({ analytics: true, marketing: false });
    applyTracking(ALL, { analytics: true, marketing: false });
    expect(scripts()).toEqual([
      'https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234',
      'https://www.googletagmanager.com/gtag/js?id=G-ABCD1234',
      'https://www.clarity.ms/tag/abc123xyz',
      'https://mc.yandex.ru/metrika/tag.js',
    ]);
    // Consent Mode v2: denied by default before anything Google, then the visitor's choice.
    const layer = calls().dataLayer;
    expect(layer[0]).toEqual([
      'consent',
      'default',
      expect.objectContaining({ ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }),
    ]);
    expect(layer[1]).toEqual([
      'consent',
      'update',
      { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' },
    ]);
    expect(calls().fbq).toEqual([]);

    applyTracking(ALL, { analytics: true, marketing: true });
    expect(scripts()).toEqual(
      expect.arrayContaining([
        'https://connect.facebook.net/en_US/fbevents.js',
        'https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=C4A1B2C3D4E5F6G7H8I9&lib=ttq',
        'https://snap.licdn.com/li.lms-analytics/insight.min.js',
      ]),
    );
    expect(scripts()).toHaveLength(7);
    expect(calls().dataLayer.at(-1)).toEqual(['consent', 'update', expect.objectContaining({ ad_storage: 'granted' })]);
    expect(calls().fbq[0]).toEqual(['init', '123456789012345']);
  });

  it('sends events with the server’s event ids, a purchase once per order, and holds events until a tag loads', () => {
    trackPageView();
    trackEvent({ name: 'purchase', orderId: 'ord_1', currency: 'USD', value: 49, items: [{ id: 'funnels', name: 'Funnels', price: 49 }] });
    expect(localStorage.getItem('coursiva:purchase:ord_1')).toBeNull();

    applyTracking(ALL, { analytics: false, marketing: true });
    const purchase = calls().fbq.find((c) => c[1] === 'Purchase');
    expect(purchase).toEqual([
      'track',
      'Purchase',
      expect.objectContaining({ value: 49, currency: 'USD', content_ids: ['funnels'] }),
      { eventID: 'purchase_ord_1' },
    ]);
    expect(calls().fbq.filter((c) => c[1] === 'PageView')).toHaveLength(1);
    expect(calls().ttq).toContainEqual([
      'track',
      'CompletePayment',
      expect.objectContaining({ value: 49 }),
      { event_id: 'purchase_ord_1' },
    ]);
    expect(localStorage.getItem('coursiva:purchase:ord_1')).toBe('1');

    // The success page again (a reload, another visit): no second purchase.
    trackEvent({ name: 'purchase', orderId: 'ord_1', currency: 'USD', value: 49, items: [] });
    expect(calls().fbq.filter((c) => c[1] === 'Purchase')).toHaveLength(1);

    trackEvent({ name: 'sign_up', userId: 'usr_1' });
    trackEvent({ name: 'lead', submissionId: 'fsb_1' });
    expect(calls().fbq).toContainEqual(['track', 'CompleteRegistration', {}, { eventID: 'sign_up_usr_1' }]);
    expect(calls().fbq).toContainEqual(['track', 'Lead', {}, { eventID: 'lead_fsb_1' }]);
    expect(eventIdOf({ name: 'view_item', item: { id: 'x', name: 'x' } })).toBeNull();
    expect(major({ amount: 4950, currency: 'USD' })).toBe(49.5);
    expect(major({ amount: 3000, currency: 'JPY' })).toBe(3000);
  });

  it('gives the purchase the line ids the server-side copy sends (ref_id), not titles', () => {
    const usd = (amount: number) => ({ amount, currency: 'USD' });
    const line = {
      kind: 'course' as const,
      meta: '',
      cover: { url: null, color: '#123', alt: '' },
      tax: usd(0),
      courseSlug: null,
      liveSessionId: null,
    };
    expect(
      purchaseItems({
        items: [
          { ...line, title: 'Funnels', unitPrice: usd(4900), quantity: 1, refId: 'crs_1' },
          { ...line, title: 'Old line', unitPrice: usd(1000), quantity: 2, refId: null },
        ],
      }),
    ).toEqual([
      { id: 'crs_1', name: 'Funnels', price: 49, quantity: 1 },
      { id: 'Old line', name: 'Old line', price: 10, quantity: 2 },
    ]);
  });

  it('sends GA4 its e-commerce events', () => {
    applyTracking({ ...NO_TRACKING, ga4: 'G-ABCD1234' }, { analytics: true, marketing: false });
    trackPageView();
    trackEvent({ name: 'begin_checkout', currency: 'EUR', value: 20, items: [{ id: 'a', name: 'A', price: 20 }] });
    const events = calls().dataLayer.filter((c) => Array.isArray(c) && c[0] === 'event');
    expect(events.map((e) => (e as unknown[])[1])).toEqual(['page_view', 'begin_checkout']);
    expect((events[1] as unknown[])[2]).toEqual({
      value: 20,
      currency: 'EUR',
      items: [{ item_id: 'a', item_name: 'A', price: 20, quantity: 1 }],
    });
  });
});

describe('conversion signal', () => {
  it('sends only what the visitor allows', () => {
    document.cookie = '_ga=GA1.1.123456789.1700000000; path=/';
    document.cookie = '_fbp=fb.1.1700000000000.42; path=/';
    sessionStorage.setItem('coursiva:acquisition', JSON.stringify({ gclid: 'g-1', fbclid: 'f-1', seen: ['analytics', 'marketing'] }));
    configureConsent({ required: true });
    expect(conversionSignal()).toBeNull();

    saveChoice({ analytics: true, marketing: false });
    expect(conversionSignal()).toEqual({
      analytics: true,
      marketing: false,
      page_url: 'http://localhost:3000/',
      ga_client_id: '123456789.1700000000',
    });

    saveChoice({ analytics: false, marketing: true });
    expect(conversionSignal()).toEqual({
      analytics: false,
      marketing: true,
      page_url: 'http://localhost:3000/',
      fbp: 'fb.1.1700000000000.42',
      gclid: 'g-1',
      fbclid: 'f-1',
    });
  });
});

describe('TrackingTags', () => {
  it('is left out when the school has no tags', () => {
    const { container } = render(<VerificationMeta tracking={NO_TRACKING} />);
    expect(container.innerHTML).toBe('');
  });
});
