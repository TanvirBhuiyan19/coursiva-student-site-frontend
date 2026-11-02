/**
 * Affiliate and blog attribution for the checkout (docs/api/commerce.md → `ref`, `ref_click`, `post`).
 *
 * - `?ref=<partner>` on a landing URL is reported once per browser session per partner
 *   (`POST /affiliates/{slug}/clicks`). Only when the API answers with the click is it kept in first-party
 *   `localStorage` as `{ value, click, at, days }`: for the school's cookie window (`cookie_days`, 0 = no expiry) and by
 *   its rule — `last_click` replaces what is kept, `first_click` keeps an unexpired earlier partner. The checkout sends
 *   `ref` + `ref_click`; the API checks the click against the window. An unknown partner or a failed report keeps
 *   nothing, and an entry without a click (older site versions) earns nothing, so it is dropped.
 * - The last blog post the visitor read (30 days) is sent as `post`: blog revenue is last-click.
 *
 * Values are validated, and blocked storage just means no credit. Consent (docs/consent.md): the partner link is
 * `marketing` and the blog post is `analytics`; neither is stored (nor the click reported) without its category, and
 * both are forgotten when it is withdrawn (`features/consent/tracking`).
 */

const REF_KEY = 'coursiva:ref';
const POST_KEY = 'coursiva:post';
const CLICKED_KEY = 'coursiva:ref-clicked';
/** How long the last blog post read is kept. */
export const POST_DAYS = 30;
const DAY_MS = 86_400_000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const CLICK_ID = /^[A-Za-z0-9_-]{1,32}$/;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** `POST /affiliates/{slug}/clicks` → `201` (camelCased): the click and the program's window and rule. */
export interface AffiliateClick {
  clickId: string;
  cookieDays: number;
  attribution: 'first_click' | 'last_click';
}

interface KeptRef {
  value: string;
  click: string;
  at: number;
  /** The school's cookie window when the click was kept; 0 = no expiry. */
  days: number;
}

function parse(store: Store, key: string): Record<string, unknown> | null {
  try {
    const raw: unknown = JSON.parse(store.getItem(key) ?? 'null');
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The kept partner click, or null; an expired, malformed or click-less entry is dropped. */
function readRef(store: Store, now: number): KeptRef | null {
  if (store.getItem(REF_KEY) === null) return null;
  const raw = parse(store, REF_KEY);
  const { value, click, at, days } = raw ?? {};
  const valid =
    typeof value === 'string' &&
    SLUG.test(value) &&
    typeof click === 'string' &&
    CLICK_ID.test(click) &&
    typeof at === 'number' &&
    typeof days === 'number' &&
    Number.isInteger(days) &&
    days >= 0;
  if (!valid || (days > 0 && now - at > days * DAY_MS)) {
    store.removeItem(REF_KEY);
    return null;
  }
  return { value, click, at, days };
}

function readPost(store: Store, now: number): string | null {
  const { value, at } = parse(store, POST_KEY) ?? {};
  if (typeof value !== 'string' || typeof at !== 'number' || !SLUG.test(value)) return null;
  if (now - at > POST_DAYS * DAY_MS) {
    store.removeItem(POST_KEY);
    return null;
  }
  return value;
}

function clickedThisSession(session: Pick<Storage, 'getItem'>): string[] {
  try {
    const raw: unknown = JSON.parse(session.getItem(CLICKED_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The landing URL's partner (`?ref=`) when this session should report a click for it (once per session per partner,
 * marked before the report so a failing one isn't retried on every page), else null.
 */
export function refToReport(session: Pick<Storage, 'getItem' | 'setItem'>, href: string): string | null {
  const ref = new URL(href).searchParams.get('ref')?.trim().toLowerCase() ?? '';
  if (!SLUG.test(ref)) return null;
  const clicked = clickedThisSession(session);
  if (clicked.includes(ref)) return null;
  session.setItem(CLICKED_KEY, JSON.stringify([...clicked, ref].slice(-20)));
  return ref;
}

/** Keeps a reported click by the school's rule. Returns whether it is now the kept partner click. */
export function keepClick(store: Store, slug: string, click: AffiliateClick, now = Date.now()): boolean {
  if (!SLUG.test(slug) || !CLICK_ID.test(click.clickId) || !Number.isInteger(click.cookieDays) || click.cookieDays < 0) return false;
  if (click.attribution === 'first_click' && readRef(store, now)) return false;
  const kept: KeptRef = { value: slug, click: click.clickId, at: now, days: click.cookieDays };
  store.setItem(REF_KEY, JSON.stringify(kept));
  return true;
}

export function rememberPostIn(store: Store, slug: string, now = Date.now()): void {
  if (SLUG.test(slug)) store.setItem(POST_KEY, JSON.stringify({ value: slug, at: now }));
}

export function referralFrom(store: Store, now = Date.now()): { ref: string | null; refClick: string | null; post: string | null } {
  const kept = readRef(store, now);
  return { ref: kept?.value ?? null, refClick: kept?.click ?? null, post: readPost(store, now) };
}

/* Browser wrappers: storage can throw on access, so it's read inside the guard. */

/**
 * Reports the landing URL's partner click (once per session per partner) and keeps it when the API answers. `report`
 * resolves null when the click wasn't recorded (unknown partner, network error, consent withdrawn meanwhile).
 */
export async function captureReferral(
  report: (slug: string) => Promise<AffiliateClick | null>,
  href = window.location.href,
): Promise<void> {
  let slug: string | null;
  try {
    slug = refToReport(window.sessionStorage, href);
  } catch {
    return; // No storage: nothing could be kept anyway.
  }
  if (!slug) return;
  const click = await report(slug);
  if (!click) return;
  try {
    keepClick(window.localStorage, slug, click);
  } catch {
    // No storage.
  }
}

/** Forgets the partner link (and this session's click markers): marketing withdrawn. */
export function forgetReferral(): void {
  try {
    window.localStorage.removeItem(REF_KEY);
    window.sessionStorage.removeItem(CLICKED_KEY);
  } catch {
    // No storage.
  }
}

/** Forgets the last blog post read: analytics withdrawn. */
export function forgetPost(): void {
  try {
    window.localStorage.removeItem(POST_KEY);
  } catch {
    // No storage.
  }
}

export function rememberPost(slug: string): void {
  try {
    rememberPostIn(window.localStorage, slug);
  } catch {
    // No storage.
  }
}

export function referral(): { ref: string | null; refClick: string | null; post: string | null } {
  try {
    return referralFrom(window.localStorage);
  } catch {
    return { ref: null, refClick: null, post: null };
  }
}
