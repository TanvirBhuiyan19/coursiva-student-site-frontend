import type { ConsentChoice } from '@/features/consent/store';
import { markInjected } from '@/features/consent/tracking';
import { TAG_CATEGORY, type SiteTracking } from './ids';

/**
 * The analytics tags and ad pixels of `GET /site` → `tracking`, loaded in the browser once the visitor allows their
 * consent category (docs/consent.md): GA4, Google Tag Manager, Microsoft Clarity and Yandex Metrica are analytics;
 * the Meta pixel, TikTok pixel and LinkedIn Insight Tag are marketing. Browser-only (client components call it).
 *
 * Each tag is the vendor's own loader, written here as code rather than pasted HTML: the only school data in it is
 * the validated id (`ids.ts`), always URL-encoded or passed as a value — never concatenated into script text.
 * Google Consent Mode v2 defaults are set to denied before any Google tag loads, then updated from the visitor's choice.
 */

export type Tool = 'google' | 'clarity' | 'yandex' | 'meta' | 'tiktok' | 'linkedin';

type Fn = ((...args: unknown[]) => void) & Record<string, unknown>;
type TrackingWindow = Window & {
  dataLayer?: unknown[];
  gtag?: Fn;
  fbq?: Fn;
  _fbq?: Fn;
  ttq?: unknown[] & Record<string, unknown>;
  clarity?: Fn;
  ym?: Fn;
  lintrk?: Fn;
  _linkedin_partner_id?: string;
  _linkedin_data_partner_ids?: string[];
};

const w = () => window as TrackingWindow;
const loaded = new Set<Tool>();
let consentDefaults = false;

function script(src: string) {
  const el = document.createElement('script');
  el.async = true;
  el.src = src;
  el.dataset.coursivaTracking = 'true';
  document.head.append(el);
}

/** `gtag()` must queue the `arguments` object itself (gtag.js reads Arguments, not arrays). */
function gtagStub(): Fn {
  const win = w();
  win.dataLayer = win.dataLayer ?? [];
  if (!win.gtag) {
    win.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      win.dataLayer!.push(arguments);
    } as Fn;
  }
  return win.gtag;
}

const googleConsent = (choice: ConsentChoice) => ({
  analytics_storage: choice.analytics ? 'granted' : 'denied',
  ad_storage: choice.marketing ? 'granted' : 'denied',
  ad_user_data: choice.marketing ? 'granted' : 'denied',
  ad_personalization: choice.marketing ? 'granted' : 'denied',
});

/** Consent Mode v2: everything denied until the visitor's choice is applied (set once, before any Google tag). */
function ensureConsentDefaults() {
  if (consentDefaults) return;
  consentDefaults = true;
  gtagStub()('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    wait_for_update: 500,
  });
}

function loadGoogle(t: SiteTracking, choice: ConsentChoice) {
  ensureConsentDefaults();
  const gtag = gtagStub();
  gtag('consent', 'update', googleConsent(choice));
  if (t.gtm) {
    w().dataLayer!.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    script(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(t.gtm)}`);
  }
  if (t.ga4) {
    script(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(t.ga4)}`);
    gtag('js', new Date());
    // Page views are sent by the site (client-side navigation), not by the config call.
    gtag('config', t.ga4, { send_page_view: false });
  }
}

function loadClarity(id: string) {
  const win = w();
  if (!win.clarity) {
    const clarity = function () {
      // eslint-disable-next-line prefer-rest-params
      (clarity.q as unknown[]).push(arguments);
    } as Fn;
    clarity.q = [];
    win.clarity = clarity;
  }
  script(`https://www.clarity.ms/tag/${encodeURIComponent(id)}`);
}

function loadYandex(id: string) {
  const win = w();
  if (!win.ym) {
    const ym = function () {
      // eslint-disable-next-line prefer-rest-params
      (ym.a as unknown[]).push(arguments);
    } as Fn;
    ym.a = [];
    ym.l = Date.now();
    win.ym = ym;
  }
  script('https://mc.yandex.ru/metrika/tag.js');
  // `defer`: page views are sent by the site (`hit`) on every navigation.
  win.ym(Number(id), 'init', { defer: true, clickmap: true, trackLinks: true, accurateTrackBounce: true });
}

function loadMeta(id: string) {
  const win = w();
  if (!win.fbq) {
    const fbq = function (...args: unknown[]) {
      if (typeof fbq.callMethod === 'function') (fbq.callMethod as (...a: unknown[]) => void)(...args);
      else (fbq.queue as unknown[][]).push(args);
    } as Fn;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.queue = [];
    win.fbq = fbq;
    win._fbq = fbq;
  }
  script('https://connect.facebook.net/en_US/fbevents.js');
  win.fbq('init', id);
}

const TTQ_METHODS = [
  'page',
  'track',
  'identify',
  'instances',
  'debug',
  'on',
  'off',
  'once',
  'ready',
  'alias',
  'group',
  'enableCookie',
  'disableCookie',
  'holdConsent',
  'revokeConsent',
  'grantConsent',
];

function loadTikTok(id: string) {
  const win = w();
  const ttq = (win.ttq = win.ttq ?? ([] as unknown as NonNullable<TrackingWindow['ttq']>));
  const defer = (target: unknown[] & Record<string, unknown>, method: string) => {
    target[method] = (...args: unknown[]) => target.push([method, ...args]);
  };
  if (!ttq.methods) {
    ttq.methods = TTQ_METHODS;
    for (const m of TTQ_METHODS) defer(ttq, m);
    ttq.instance = (pixel: string) => {
      const inst = ((ttq._i as Record<string, unknown[] & Record<string, unknown>>)[pixel] ?? []) as unknown[] & Record<string, unknown>;
      for (const m of TTQ_METHODS) defer(inst, m);
      return inst;
    };
  }
  const url = 'https://analytics.tiktok.com/i18n/pixel/events.js';
  const instances: Record<string, unknown> = (ttq._i as Record<string, unknown> | undefined) ?? {};
  const loadedAt: Record<string, number> = (ttq._t as Record<string, number> | undefined) ?? {};
  const options: Record<string, unknown> = (ttq._o as Record<string, unknown> | undefined) ?? {};
  instances[id] = Object.assign([] as unknown[], { _u: url });
  loadedAt[id] = Date.now();
  options[id] = {};
  ttq._i = instances;
  ttq._t = loadedAt;
  ttq._o = options;
  script(`${url}?sdkid=${encodeURIComponent(id)}&lib=ttq`);
}

function loadLinkedIn(id: string) {
  const win = w();
  win._linkedin_partner_id = id;
  win._linkedin_data_partner_ids = [...(win._linkedin_data_partner_ids ?? []), id];
  if (!win.lintrk) {
    const lintrk = function (a: unknown, b: unknown) {
      (lintrk.q as unknown[][]).push([a, b]);
    } as Fn;
    lintrk.q = [];
    win.lintrk = lintrk;
  }
  script('https://snap.licdn.com/li.lms-analytics/insight.min.js');
}

const LOADERS: {
  tool: Tool;
  category: 'analytics' | 'marketing';
  present: (t: SiteTracking) => boolean;
  load: (t: SiteTracking, c: ConsentChoice) => void;
}[] = [
  { tool: 'google', category: 'analytics', present: (t) => !!(t.ga4 || t.gtm), load: loadGoogle },
  { tool: 'clarity', category: TAG_CATEGORY.clarity, present: (t) => !!t.clarity, load: (t) => loadClarity(t.clarity!) },
  { tool: 'yandex', category: TAG_CATEGORY.yandexMetrica, present: (t) => !!t.yandexMetrica, load: (t) => loadYandex(t.yandexMetrica!) },
  { tool: 'meta', category: TAG_CATEGORY.metaPixel, present: (t) => !!t.metaPixel, load: (t) => loadMeta(t.metaPixel!) },
  { tool: 'tiktok', category: TAG_CATEGORY.tiktokPixel, present: (t) => !!t.tiktokPixel, load: (t) => loadTikTok(t.tiktokPixel!) },
  {
    tool: 'linkedin',
    category: TAG_CATEGORY.linkedinPartner,
    present: (t) => !!t.linkedinPartner,
    load: (t) => loadLinkedIn(t.linkedinPartner!),
  },
];

/**
 * Loads every tag the visitor's choice allows that isn't loaded yet → the tools loaded by this call. Google's consent
 * state follows every change. A withdrawn category reloads the page (consent/tracking.ts), so nothing is unloaded here.
 */
export function applyTags(t: SiteTracking, choice: ConsentChoice): Tool[] {
  if (loaded.has('google')) gtagStub()('consent', 'update', googleConsent(choice));
  const fresh: Tool[] = [];
  for (const l of LOADERS) {
    if (loaded.has(l.tool) || !l.present(t) || !choice[l.category]) continue;
    loaded.add(l.tool);
    markInjected(l.category);
    l.load(t, choice);
    fresh.push(l.tool);
  }
  return fresh;
}

export const isLoaded = (tool: Tool): boolean => loaded.has(tool);

export const tagWindow = w;

/** Test helper: a fresh page. */
export function resetTagsForTests() {
  loaded.clear();
  consentDefaults = false;
}
