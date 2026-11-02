import type { Acquisition } from '@/features/commerce/types';

/**
 * First-touch acquisition hints (docs/api/commerce.md → `acquisition`). On the first page of a browser session the
 * site keeps the landing URL's `utm_source`/`utm_medium`/`utm_campaign`, its ad click ids (`gclid`, `fbclid`, `ttclid`,
 * `li_fat_id`, `msclkid`, `epik`, `twclid`) and an external referrer's origin in sessionStorage,
 * and the checkout sends them so the API can label the order's source. Nothing else is stored; first touch wins.
 *
 * Consent (docs/consent.md): campaign hints (UTM + referrer) are `analytics`, click ids are `marketing`. Each group is
 * only stored once the visitor allows its category (`allow`), and is forgotten when the category is withdrawn.
 */

const KEY = 'coursiva:acquisition';
/** Lengths the API validates; longer values are cut so they can never fail a checkout. */
const MAX = {
  utmSource: 100,
  utmMedium: 100,
  utmCampaign: 100,
  referrer: 500,
  gclid: 200,
  fbclid: 500, // Facebook click ids can be long; the backend accepts 500
  ttclid: 200,
  liFatId: 200,
  msclkid: 200,
  epik: 200,
  twclid: 200,
} as const;

/** Landing-URL query parameter → hint field (everything except the referrer, which comes from `document.referrer`). */
const PARAMS: [param: string, field: Exclude<keyof typeof MAX, 'referrer'>][] = [
  ['utm_source', 'utmSource'],
  ['utm_medium', 'utmMedium'],
  ['utm_campaign', 'utmCampaign'],
  ['gclid', 'gclid'],
  ['fbclid', 'fbclid'],
  ['ttclid', 'ttclid'],
  ['li_fat_id', 'liFatId'],
  ['msclkid', 'msclkid'],
  ['epik', 'epik'],
  ['twclid', 'twclid'],
];

type SessionStore = Pick<Storage, 'getItem' | 'setItem'>;

/** Which consent category each hint belongs to. */
export type HintCategory = 'analytics' | 'marketing';
const CATEGORY: Record<keyof typeof MAX, HintCategory> = {
  utmSource: 'analytics',
  utmMedium: 'analytics',
  utmCampaign: 'analytics',
  referrer: 'analytics',
  gclid: 'marketing',
  fbclid: 'marketing',
  ttclid: 'marketing',
  liFatId: 'marketing',
  msclkid: 'marketing',
  epik: 'marketing',
  twclid: 'marketing',
};
export type HintConsent = Record<HintCategory, boolean>;
const ALL: HintConsent = { analytics: true, marketing: true };
/** Stored next to the hints: the categories this session's first touch was already recorded for. */
const SEEN = 'seen';

function only(hints: Acquisition, allow: HintConsent): Acquisition {
  const out: Acquisition = {};
  for (const key of Object.keys(MAX) as (keyof typeof MAX)[]) {
    const value = hints[key];
    if (value && allow[CATEGORY[key]]) out[key] = value;
  }
  return out;
}

function readRecord(store: SessionStore): Record<string, unknown> | null {
  const raw: unknown = JSON.parse(store.getItem(KEY) ?? 'null');
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
}

function seenOf(record: Record<string, unknown>): HintCategory[] {
  const seen = record[SEEN];
  // A record from before consent categories counted as both.
  if (!Array.isArray(seen)) return ['analytics', 'marketing'];
  return seen.filter((c): c is HintCategory => c === 'analytics' || c === 'marketing');
}

/** Builds the hints for a landing page. The referrer counts only when it's another site, and only its origin. */
export function acquisitionFrom(href: string, referrer: string): Acquisition {
  const url = new URL(href);
  const hints: Acquisition = {};
  for (const [param, field] of PARAMS) {
    const value = url.searchParams.get(param)?.trim();
    if (value) hints[field] = value.slice(0, MAX[field]);
  }
  try {
    const ref = referrer ? new URL(referrer) : null;
    if (ref && /^https?:$/.test(ref.protocol) && ref.host !== url.host) hints.referrer = ref.origin.slice(0, MAX.referrer);
  } catch {
    // Not a URL: ignore.
  }
  return hints;
}

/**
 * Records the session's first touch once per allowed category (an empty record too, so a later page never overwrites
 * it). A category allowed later on the same visit adds its own hints from the landing page, never replacing others.
 */
export function captureAcquisition(store: SessionStore, href: string, referrer: string, allow: HintConsent = ALL): void {
  try {
    const allowed = (Object.keys(allow) as HintCategory[]).filter((c) => allow[c]);
    if (!allowed.length) return;
    const record = readRecord(store);
    const seen = record ? seenOf(record) : [];
    const fresh = allowed.filter((c) => !seen.includes(c));
    if (!fresh.length) return;
    const hints = only(acquisitionFrom(href, referrer), {
      analytics: fresh.includes('analytics'),
      marketing: fresh.includes('marketing'),
    });
    store.setItem(KEY, JSON.stringify({ ...(record ?? {}), ...hints, [SEEN]: [...seen, ...fresh] }));
  } catch {
    // Storage blocked (private mode, disabled cookies): no hints.
  }
}

/** Forgets the hints of a withdrawn category (and that its first touch was recorded). */
export function forgetAcquisition(store: SessionStore, category: HintCategory): void {
  try {
    const record = readRecord(store);
    if (!record) return;
    const next: Record<string, unknown> = { [SEEN]: seenOf(record).filter((c) => c !== category) };
    for (const key of Object.keys(MAX) as (keyof typeof MAX)[]) {
      if (CATEGORY[key] !== category && typeof record[key] === 'string') next[key] = record[key];
    }
    store.setItem(KEY, JSON.stringify(next));
  } catch {
    // Nothing stored.
  }
}

/** The stored hints for the checkout, or `null` when there are none. Only known strings of allowed categories survive. */
export function storedAcquisition(store: SessionStore, allow: HintConsent = ALL): Acquisition | null {
  try {
    const raw: unknown = JSON.parse(store.getItem(KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const hints: Acquisition = {};
    for (const key of Object.keys(MAX) as (keyof typeof MAX)[]) {
      const value = record[key];
      if (typeof value === 'string' && value && allow[CATEGORY[key]]) hints[key] = value.slice(0, MAX[key]);
    }
    return Object.keys(hints).length ? hints : null;
  } catch {
    return null;
  }
}

/** Browser wrappers: `sessionStorage` can throw on access, so it's read inside the guard. */
export function captureFirstTouch(allow: HintConsent, landing: { href: string; referrer: string }): void {
  try {
    captureAcquisition(window.sessionStorage, landing.href, landing.referrer, allow);
  } catch {
    // No storage.
  }
}

export function firstTouch(allow: HintConsent): Acquisition | null {
  try {
    return storedAcquisition(window.sessionStorage, allow);
  } catch {
    return null;
  }
}

export function forgetFirstTouch(category: HintCategory): void {
  try {
    forgetAcquisition(window.sessionStorage, category);
  } catch {
    // No storage.
  }
}
