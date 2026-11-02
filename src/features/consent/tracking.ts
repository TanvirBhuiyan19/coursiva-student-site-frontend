import { captureFirstTouch, firstTouch, forgetFirstTouch } from '@/features/analytics/acquisition';
import { reportAffiliateClick } from '@/features/analytics/api';
import { captureReferral, forgetPost, forgetReferral, referral, rememberPost } from '@/features/analytics/referral';
import type { Acquisition } from '@/features/commerce/types';
import { CONSENT_CATEGORIES, granted, onConsentChange, setConsentMode, type ConsentCategory, type ConsentSnapshot } from './store';

/**
 * Everything the storefront itself stores or reports for attribution, gated by the visitor's consent
 * (docs/consent.md). Browser-only; called from client components.
 *
 * | category  | what                                                                                   |
 * | analytics | UTM + external referrer first touch (sessionStorage), last blog post read (30 days)      |
 * | marketing | ad click ids (gclid, fbclid, …), partner click report + its click id (school's window and rule)|
 *
 * The landing URL is kept in memory only, so a category the visitor allows later on the same visit still gets the
 * visit's first touch. Withdrawing a category forgets what it stored and deletes the trackers' first-party cookies; if
 * the school's scripts of that category already ran, the page reloads so they stop.
 */

let landing: { href: string; referrer: string } | null = null;
let subscribed = false;
const injected = new Set<ConsentCategory>();

/** First-party cookies that analytics / ad tools set on the school's own domain (deleted on withdrawal). */
const TRACKER_COOKIES: Record<ConsentCategory, RegExp> = {
  analytics: /^(?:_ga(?:_.*)?|_gid|_gat.*|_hj.*|_clck|_clsk|_pk_.*|mp_.*|ajs_.*|_dc_gtm_.*)$/,
  marketing: /^(?:_fbp|_fbc|_gcl_.*|_ttp|_tt_enable_cookie|_uet.*|_pin_unauth|_scid.*|_rdt_uuid|li_fat_id|_twclid|muc_ads)$/,
};

function deleteCookies(pattern: RegExp) {
  const host = window.location.hostname;
  const parts = host.split('.');
  // The cookie may have been set for this host or any parent domain (`.school.com`).
  const domains = [null, ...parts.slice(0, -1).map((_, i) => parts.slice(i).join('.'))];
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]?.trim() ?? '';
    if (!name || !pattern.test(name)) continue;
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`;
    }
  }
}

function allowed() {
  return { analytics: granted('analytics'), marketing: granted('marketing') };
}

/** Stores what the visitor allows of this visit's first touch, and reports a partner click once marketing is on. */
function captureAllowed() {
  const allow = allowed();
  if (landing && (allow.analytics || allow.marketing)) captureFirstTouch(allow, landing);
  if (allow.marketing) void captureReferral(reportMarketingClick, landing?.href);
}

/** Reports a partner click; its answer is kept only if marketing is still allowed when it arrives. */
async function reportMarketingClick(slug: string) {
  const click = await reportAffiliateClick(slug);
  return click && granted('marketing') ? click : null;
}

function forget(category: ConsentCategory) {
  forgetFirstTouch(category);
  if (category === 'marketing') forgetReferral();
  else forgetPost();
  deleteCookies(TRACKER_COOKIES[category]);
}

function onTransition(prev: ConsentSnapshot, next: ConsentSnapshot) {
  if (!prev.ready || !next.ready) {
    if (next.ready) captureAllowed();
    return;
  }
  const revoked = CONSENT_CATEGORIES.filter((c) => prev[c] && !next[c]);
  revoked.forEach(forget);
  // A script can't be unloaded: reload so the school's code of a withdrawn category stops running.
  if (revoked.some((c) => injected.has(c))) {
    window.location.reload();
    return;
  }
  if (CONSENT_CATEGORIES.some((c) => !prev[c] && next[c])) captureAllowed();
}

/** Called once per page by the site (`Providers`) with the school's mode: cookie banner on = ask first. */
export function configureConsent(opts: { required: boolean }) {
  landing ??= { href: window.location.href, referrer: document.referrer };
  if (!subscribed) {
    onConsentChange(onTransition);
    subscribed = true;
  }
  setConsentMode(opts);
}

/** Records that school code of `category` ran on this page (so withdrawing it reloads the page). */
export function markInjected(category: ConsentCategory) {
  injected.add(category);
}

/** The attribution the checkout may send: only what the visitor allows right now. */
export function checkoutAttribution(): {
  acquisition: Acquisition | null;
  ref: string | null;
  refClick: string | null;
  post: string | null;
} {
  const allow = allowed();
  const { ref, refClick, post } = referral();
  return {
    acquisition: allow.analytics || allow.marketing ? firstTouch(allow) : null,
    ref: allow.marketing ? ref : null,
    refClick: allow.marketing ? refClick : null,
    post: allow.analytics ? post : null,
  };
}

/** `tracking` on checkout, sign-up and lead requests, as sent on the wire (snake_case; docs/api/commerce.md). */
export interface ConversionSignal {
  analytics: boolean;
  marketing: boolean;
  page_url?: string;
  ga_client_id?: string;
  fbp?: string;
  fbc?: string;
  ttp?: string;
  gclid?: string;
  fbclid?: string;
  ttclid?: string;
}

function cookie(name: string): string | null {
  for (const pair of document.cookie.split(';')) {
    const [k, ...v] = pair.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(v.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * What the API may use for server-side conversions (Meta Conversions API, GA4 Measurement Protocol, TikTok Events
 * API): the visitor's consent and, only as far as it allows, the tags' first-party browser ids and the visit's ad
 * click ids. Null when the visitor allows neither category — the API then sends nothing server-side. The page URL is
 * sent without its query string (it can carry personal data).
 */
export function conversionSignal(): ConversionSignal | null {
  const allow = allowed();
  if (!allow.analytics && !allow.marketing) return null;
  const out: ConversionSignal = { analytics: allow.analytics, marketing: allow.marketing };
  try {
    out.page_url = `${window.location.origin}${window.location.pathname}`;
    if (allow.analytics) {
      // `_ga` = GA1.1.<client id>: the client id is its last two parts.
      const ga = cookie('_ga')?.split('.').slice(-2).join('.');
      if (ga && /^\d{1,12}\.\d{1,12}$/.test(ga)) out.ga_client_id = ga;
    }
    if (allow.marketing) {
      const fbp = cookie('_fbp');
      const fbc = cookie('_fbc');
      const ttp = cookie('_ttp');
      if (fbp) out.fbp = fbp;
      if (fbc) out.fbc = fbc;
      if (ttp) out.ttp = ttp;
      const touch = firstTouch({ analytics: false, marketing: true });
      if (touch?.gclid) out.gclid = touch.gclid;
      if (touch?.fbclid) out.fbclid = touch.fbclid;
      if (touch?.ttclid) out.ttclid = touch.ttclid;
    }
  } catch {
    // No cookies or storage: consent alone.
  }
  return out;
}

/** Remembers the blog post being read (last-click blog revenue) when analytics is allowed. */
export function rememberPostRead(slug: string) {
  if (granted('analytics')) rememberPost(slug);
}

/** Test helper: a fresh page. */
export function resetTrackingForTests() {
  landing = null;
  subscribed = false;
  injected.clear();
}
