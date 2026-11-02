import { normalizeTracking } from '@/features/tracking/ids';
import type { AuthScreen, LegalScreen, NavLink, Site, SiteNavigation, SiteTheme } from './types';

/**
 * `GET /site` as the storefront renders it, whatever version of the API (or of a cached response) produced it.
 * A response cached before the site builder fields existed — or a partial one — must never crash the layout: every
 * field added since (navigation, theme, announcement, favicon, icon, head code, cookie banner, site lock, pages,
 * screens) gets a safe default, and nested objects are filled field by field.
 */
type Raw = Record<string, unknown>;

const rec = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? (v as unknown[]) : []);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);

const THEME = {
  font: ['bricolage_instrument', 'editorial_serif', 'minimal_sans'],
  radius: ['sharp', 'soft', 'round'],
  buttons: ['filled', 'outline', 'soft'],
  density: ['compact', 'comfortable'],
} as const satisfies Record<keyof SiteTheme, readonly string[]>;

const links = (v: unknown): NavLink[] =>
  arr(v)
    .map(rec)
    .filter((l) => typeof l.href === 'string')
    .map((l) => ({ label: str(l.label), href: str(l.href) }));

function navigation(raw: unknown, name: string): SiteNavigation {
  const n = rec(raw);
  const h = rec(n.header);
  const f = rec(n.footer);
  const cta = rec(h.cta);
  return {
    header: {
      logoText: str(h.logoText) || name,
      cta: str(cta.href) !== '' ? { label: str(cta.label), href: str(cta.href) } : null,
      sticky: bool(h.sticky, true),
      showCart: bool(h.showCart, false),
      showNotifications: bool(h.showNotifications, false),
      items: links(h.items),
    },
    footer: {
      tagline: str(f.tagline),
      copyright: str(f.copyright),
      columns: arr(f.columns)
        .map(rec)
        .map((c) => ({ title: str(c.title), links: links(c.links) })),
      showSocial: bool(f.showSocial, false),
      showLegal: bool(f.showLegal, true),
      showPowered: bool(f.showPowered, true),
    },
  };
}

function legal(raw: unknown): LegalScreen | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = rec(raw);
  return {
    title: str(l.title),
    updated: str(l.updated),
    back: str(l.back),
    sections: arr(l.sections)
      .map(rec)
      .map((s) => ({ heading: str(s.heading), body: str(s.body) })),
    footer: str(l.footer),
  };
}

function authScreen(raw: unknown): AuthScreen | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = rec(raw);
  const quote = rec(a.quote);
  return {
    title: str(a.title),
    subtitle: str(a.subtitle),
    button: str(a.button),
    tagline: str(a.tagline),
    quote: str(quote.text) !== '' ? { text: str(quote.text), author: str(quote.author) } : null,
    benefits: arr(a.benefits).filter((b): b is string => typeof b === 'string'),
    signup: bool(a.signup, true),
    google: bool(a.google, true),
    forgot: bool(a.forgot, true),
  };
}

/** A time zone `Intl` accepts, else null. */
function timeZone(v: unknown): string | null {
  if (typeof v !== 'string' || v === '') return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return v;
  } catch {
    return null;
  }
}

/** Whether the platform makes a capability available to this school (`unavailable` from `GET /site`). */
export const siteAvailable = (site: Pick<Site, 'unavailable'>, capability: string) => !site.unavailable.includes(capability);

export function normalizeSite(raw: unknown): Site {
  const s = rec(raw);
  const name = str(s.name);
  const theme = rec(s.theme);
  const lock = rec(s.siteLock);
  const screens = rec(s.screens);
  const legalScreens = rec(screens.legal);
  const announcement = str(rec(s.announcement).text);
  // The API applies availability to these fields already; applying it again keeps an older or cached payload honest.
  const unavailable = arr(s.unavailable).filter((k): k is string => typeof k === 'string');
  const on = (capability: string) => !unavailable.includes(capability);
  const features = rec(s.features) as Partial<Site['features']>;
  return {
    ...(s as unknown as Site),
    unavailable,
    oauthProviders: arr(s.oauthProviders).filter((p): p is string => typeof p === 'string' && on(`signin_${p}`)),
    ssoEnabled: s.ssoEnabled === true && on('sso'),
    features: {
      membership: features.membership === true && on('memberships'),
      community: features.community === true && on('community'),
      certificates: features.certificates === true && on('certs'),
      streaks: features.streaks === true,
    },
    social: arr(s.social) as Site['social'],
    navigation: navigation(s.navigation, name),
    theme: {
      font: oneOf(theme.font, THEME.font, 'bricolage_instrument'),
      radius: oneOf(theme.radius, THEME.radius, 'soft'),
      buttons: oneOf(theme.buttons, THEME.buttons, 'filled'),
      density: oneOf(theme.density, THEME.density, 'comfortable'),
    },
    announcement: announcement !== '' ? { text: announcement } : null,
    faviconUrl: str(s.faviconUrl) !== '' ? str(s.faviconUrl) : null,
    iconUrl: str(s.iconUrl) !== '' ? str(s.iconUrl) : null,
    headCode: str(s.headCode) !== '' ? str(s.headCode) : null,
    cookieBanner: bool(s.cookieBanner, true),
    tracking: normalizeTracking(s.tracking),
    timeZone: timeZone(s.timeZone),
    siteLock: { enabled: bool(lock.enabled, false), unlocked: bool(lock.unlocked, false), password: bool(lock.password, false) },
    pages: arr(s.pages)
      .map(rec)
      .filter((p) => typeof p.path === 'string')
      .map((p) => ({ path: str(p.path), title: str(p.title) })),
    screens: {
      auth: authScreen(screens.auth),
      legal: { privacy: legal(legalScreens.privacy), terms: legal(legalScreens.terms), refundPolicy: legal(legalScreens.refundPolicy) },
    },
  };
}
