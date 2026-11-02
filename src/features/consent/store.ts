/**
 * The visitor's cookie choice (docs/consent.md). Browser-only state with no React and no imports, so any client module
 * can ask `granted('marketing')` before it writes or loads anything non-essential.
 *
 * Two modes, set once per page by the site (`configureConsent` in ./tracking):
 * - **opt-in** (the school shows the cookie banner, Settings → Privacy): nothing non-essential runs until the visitor
 *   accepts that category; declining (or never answering) keeps it off.
 * - **opt-out** (banner off): categories are on unless the visitor turns them off under "Cookie settings".
 * In both, Global Privacy Control (`navigator.globalPrivacyControl`) keeps marketing off, and until the site has set the
 * mode (server render, hydration) everything is off.
 *
 * Essential storage (session, CSRF, cart, unlocks, this choice itself) is never gated.
 */

export type ConsentCategory = 'analytics' | 'marketing';
export const CONSENT_CATEGORIES: readonly ConsentCategory[] = ['analytics', 'marketing'];

export interface ConsentChoice {
  analytics: boolean;
  marketing: boolean;
}

export interface ConsentSnapshot extends ConsentChoice {
  /** The site has told the browser its mode; before that nothing is granted and no banner shows. */
  ready: boolean;
  /** Opt-in: the school asks first (cookie banner on). */
  required: boolean;
  /** The visitor has made a choice (in this browser). */
  decided: boolean;
  /** The browser sends Global Privacy Control: marketing stays off whatever is stored. */
  gpc: boolean;
  /** The cookie settings panel is open (footer link). */
  panelOpen: boolean;
}

export const CONSENT_KEY = 'coursiva_cookie_consent';
/** Fired on `window` after every change, `detail` = the effective `ConsentChoice` (for the school's own scripts). */
export const CONSENT_EVENT = 'coursiva:consent';

const NOT_READY: ConsentSnapshot = {
  ready: false,
  required: true,
  decided: false,
  gpc: false,
  panelOpen: false,
  analytics: false,
  marketing: false,
};

let required = true;
let ready = false;
let gpc = false;
let panelOpen = false;
/** In-memory copy for when storage is blocked: the choice then lasts for this page. */
let memory: string | null = null;
let snapshot: ConsentSnapshot = NOT_READY;

type Listener = (prev: ConsentSnapshot, next: ConsentSnapshot) => void;
const listeners = new Set<Listener>();

/** Reads a stored choice. The first version stored `accepted` / `declined` (everything or nothing). */
export function parseChoice(raw: string | null): ConsentChoice | null {
  if (raw === 'accepted') return { analytics: true, marketing: true };
  if (raw === 'declined') return { analytics: false, marketing: false };
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ConsentChoice> | null;
    if (!v || typeof v !== 'object') return null;
    return { analytics: v.analytics === true, marketing: v.marketing === true };
  } catch {
    return null;
  }
}

function readStored(): ConsentChoice | null {
  try {
    return parseChoice(localStorage.getItem(CONSENT_KEY) ?? memory);
  } catch {
    return parseChoice(memory);
  }
}

/** The effective choice for a mode, a stored choice and the GPC signal (pure: unit-tested). */
export function effective(opts: { required: boolean; stored: ConsentChoice | null; gpc: boolean }): ConsentChoice {
  const base = opts.stored ?? { analytics: !opts.required, marketing: !opts.required };
  return { analytics: base.analytics, marketing: base.marketing && !opts.gpc };
}

function recompute() {
  const prev = snapshot;
  if (!ready) {
    snapshot = NOT_READY;
  } else {
    const stored = readStored();
    const eff = effective({ required, stored, gpc });
    const next: ConsentSnapshot = { ready, required, decided: stored !== null, gpc, panelOpen, ...eff };
    const same = (Object.keys(next) as (keyof ConsentSnapshot)[]).every((k) => next[k] === prev[k]);
    if (same) return;
    snapshot = next;
  }
  if (snapshot === prev) return;
  if (typeof document !== 'undefined' && snapshot.ready) {
    const { analytics, marketing } = snapshot;
    document.documentElement.dataset.cookieConsent =
      analytics && marketing ? 'accepted' : !analytics && !marketing ? 'declined' : 'partial';
    document.documentElement.dataset.consentAnalytics = analytics ? 'granted' : 'denied';
    document.documentElement.dataset.consentMarketing = marketing ? 'granted' : 'denied';
    window.dispatchEvent(new CustomEvent<ConsentChoice>(CONSENT_EVENT, { detail: { analytics, marketing } }));
  }
  listeners.forEach((l) => l(prev, snapshot));
}

let storageBound = false;
function onStorage(e: StorageEvent) {
  // A choice made in another tab applies here too.
  if (e.key === CONSENT_KEY || e.key === null) recompute();
}

/** Called once the site knows its mode (cookie banner on = opt-in). Safe to call again. */
export function setConsentMode(opts: { required: boolean }) {
  required = opts.required;
  ready = true;
  try {
    gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  } catch {
    gpc = false;
  }
  if (!storageBound && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
    storageBound = true;
  }
  recompute();
}

/** Stores the visitor's choice (essential storage: the choice itself). */
export function saveChoice(choice: ConsentChoice) {
  const value = JSON.stringify({ analytics: choice.analytics, marketing: choice.marketing, at: new Date().toISOString() });
  memory = value;
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Storage blocked: kept in memory for this page.
  }
  panelOpen = false;
  recompute();
}

export function setPanelOpen(open: boolean) {
  panelOpen = open;
  recompute();
}

export const consentSnapshot = (): ConsentSnapshot => snapshot;
export const serverSnapshot = (): ConsentSnapshot => NOT_READY;
/** Whether a category may run or store anything right now. */
export const granted = (category: ConsentCategory): boolean => snapshot[category];

/** Subscribe to changes (`prev` → `next`). Returns an unsubscribe function. */
export function onConsentChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper: a fresh page. */
export function resetConsentForTests() {
  required = true;
  ready = false;
  gpc = false;
  panelOpen = false;
  memory = null;
  snapshot = NOT_READY;
  listeners.clear();
}
