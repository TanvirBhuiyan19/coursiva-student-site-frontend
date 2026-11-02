/**
 * `GET /site` → `tracking` (docs/api/tenant.md): the school's analytics and ad-pixel ids and its site-verification
 * tokens. Pure and server-safe (the layout and the client both use it). Every id is checked again here with the same
 * strict pattern as the API: tags are built from these ids alone, so nothing else from the school can reach a script.
 * Anything missing or malformed (an older API, a cached response) is null: no tag.
 */
export interface SiteTracking {
  ga4: string | null;
  gtm: string | null;
  metaPixel: string | null;
  tiktokPixel: string | null;
  linkedinPartner: string | null;
  clarity: string | null;
  yandexMetrica: string | null;
  verification: { google: string | null; bing: string | null; yandex: string | null; pinterest: string | null };
}

type TagKey = Exclude<keyof SiteTracking, 'verification'>;
type VerificationKey = keyof SiteTracking['verification'];

export const TAG_PATTERNS: Record<TagKey, RegExp> = {
  ga4: /^G-[A-Z0-9]{4,15}$/,
  gtm: /^GTM-[A-Z0-9]{4,10}$/,
  metaPixel: /^\d{10,20}$/,
  tiktokPixel: /^[A-Z0-9]{15,25}$/,
  linkedinPartner: /^\d{4,10}$/,
  clarity: /^[a-z0-9]{6,20}$/,
  yandexMetrica: /^\d{6,10}$/,
};

export const VERIFICATION_PATTERNS: Record<VerificationKey, RegExp> = {
  google: /^[A-Za-z0-9_-]{10,100}$/,
  bing: /^[A-Za-z0-9]{10,64}$/,
  yandex: /^[A-Za-z0-9]{10,64}$/,
  pinterest: /^[A-Za-z0-9]{10,64}$/,
};

/** The `<meta name>` each verification token goes in. */
export const VERIFICATION_META: Record<VerificationKey, string> = {
  google: 'google-site-verification',
  bing: 'msvalidate.01',
  yandex: 'yandex-verification',
  pinterest: 'p:domain_verify',
};

/** Which consent category loads each tag (docs/consent.md). */
export const TAG_CATEGORY: Record<TagKey, 'analytics' | 'marketing'> = {
  ga4: 'analytics',
  gtm: 'analytics',
  clarity: 'analytics',
  yandexMetrica: 'analytics',
  metaPixel: 'marketing',
  tiktokPixel: 'marketing',
  linkedinPartner: 'marketing',
};

export const NO_TRACKING: SiteTracking = {
  ga4: null,
  gtm: null,
  metaPixel: null,
  tiktokPixel: null,
  linkedinPartner: null,
  clarity: null,
  yandexMetrica: null,
  verification: { google: null, bing: null, yandex: null, pinterest: null },
};

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const valid = (v: unknown, pattern: RegExp): string | null => (typeof v === 'string' && pattern.test(v) ? v : null);

export function normalizeTracking(raw: unknown): SiteTracking {
  const t = rec(raw);
  const v = rec(t.verification);
  const out = { ...NO_TRACKING, verification: { ...NO_TRACKING.verification } };
  for (const key of Object.keys(TAG_PATTERNS) as TagKey[]) out[key] = valid(t[key], TAG_PATTERNS[key]);
  for (const key of Object.keys(VERIFICATION_PATTERNS) as VerificationKey[])
    out.verification[key] = valid(v[key], VERIFICATION_PATTERNS[key]);
  return out;
}

/** Whether any tag would load (the layout skips the client component otherwise). */
export const hasTags = (t: SiteTracking): boolean => (Object.keys(TAG_PATTERNS) as TagKey[]).some((k) => t[k] !== null);
