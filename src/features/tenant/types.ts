import type { SiteTracking } from '@/features/tracking/ids';
/** Tenant (the course creator's white-label site). Contract: docs/api/tenant.md */

/** A theme is a hue/chroma pair; every brand colour derives from it (see lib/theme.ts). */
export interface Brand {
  hue: number;
  chroma: number;
}

/** `GET /platform/v1/domains/resolve?host=` — server-to-server, called by the proxy for every new host. */
export interface TenantResolution {
  tenant: string;
  /** The canonical host. Other hosts for the same tenant 308 here (e.g. subdomain → custom domain). */
  primaryHost: string;
  status: 'active' | 'suspended';
  indexable: boolean;
  /** Needed by the proxy to route `/<lang>/…` URLs without a second lookup. See src/i18n/locales.ts. */
  defaultLocale: string;
  locales: string[];
}

export type SocialNetwork =
  'linkedin' | 'instagram' | 'youtube' | 'x' | 'facebook' | 'tiktok' | 'threads' | 'pinterest' | 'spotify' | 'website';

/** A resolved site-builder link (a site path, `#anchor` or `https://` URL). */
export interface NavLink {
  label: string;
  href: string;
}

/** The site builder's header and footer (docs/api/tenant.md → "Site-builder output"). */
export interface SiteNavigation {
  header: {
    /** The header's logo text, else the school name. */
    logoText: string;
    cta: NavLink | null;
    sticky: boolean;
    showCart: boolean;
    showNotifications: boolean;
    items: NavLink[];
  };
  footer: {
    tagline: string;
    copyright: string;
    columns: { title: string; links: NavLink[] }[];
    showSocial: boolean;
    showLegal: boolean;
    /** Forced on unless the plan is white-label. */
    showPowered: boolean;
  };
}

/** Theme tokens; mapped to CSS variables and fonts by the root layout (`data-*` on <html>, styles/tokens.css). */
export interface SiteTheme {
  font: 'bricolage_instrument' | 'editorial_serif' | 'minimal_sans';
  radius: 'sharp' | 'soft' | 'round';
  buttons: 'filled' | 'outline' | 'soft';
  density: 'compact' | 'comfortable';
}

/** The sign-in screen, from the `auth` section of the builder page at `/login` or `/sign-in`. */
export interface AuthScreen {
  title: string;
  subtitle: string;
  button: string;
  tagline: string;
  quote: { text: string; author: string } | null;
  benefits: string[];
  /** Show the create-account tab. */
  signup: boolean;
  /** Show "Continue with Google" (only if `oauthProviders` has google). */
  google: boolean;
  /** Show the forgot-password link. */
  forgot: boolean;
}

/** A legal page, from the `legal` section of the builder page at `/privacy`, `/terms` or `/refund-policy`. */
export interface LegalScreen {
  title: string;
  /** Free text the school typed ("Last updated 1 August 2026"). */
  updated: string;
  back: string;
  /** `body`: Markdown (the builder's rich text); older plain text renders as before. */
  sections: { heading: string; body: string }[];
  footer: string;
}

/** `GET /api/v1/site` — everything the chrome (header, footer, theme, SEO defaults) needs. Cached per tenant. */
export interface Site {
  slug: string;
  name: string;
  /** Legal name for the © line; usually equal to `name`. */
  legalName: string;
  /** One-line description (footer, default meta description). */
  tagline: string;
  logoUrl: string | null;
  /**
   * The square school icon from Branding (`icon_url`), else null: the favicon fallback when the site builder has no
   * favicon, and the apple-touch icon. Null in payloads cached before the field existed.
   */
  iconUrl: string | null;
  /** White-label plans hide the "Powered by Coursiva" credit. */
  whiteLabel: boolean;
  brand: Brand;
  /** BCP 47 tag of the main language, e.g. `en-US` — served unprefixed. */
  defaultLocale: string;
  /** Every published language, default first; others are served under `/<lang>/…` (src/i18n/locales.ts). */
  locales: string[];
  currency: string;
  /**
   * The school's time zone (IANA, `time_zone`; `UTC` when the workspace hasn't set one). Lesson unlock dates and live
   * session times are shown in it. Null when absent (older APIs) or not a zone this runtime knows — then the viewer's.
   */
  timeZone: string | null;
  primaryHost: string;
  supportEmail: string;
  social: { network: SocialNetwork; url: string }[];
  seo: {
    title: string;
    description: string;
    indexable: boolean;
    ogImageUrl: string | null;
    twitterHandle: string | null;
  };
  /** Left-hand panel on the sign-in / sign-up pages. */
  authPitch: { title: string; bullets: string[]; quote: { text: string; author: string; rating: number } | null };
  /** Social sign-in providers the platform has an OAuth client for (`google` today). One button each. */
  oauthProviders: string[];
  /**
   * The school has SAML single sign-on on: show "Sign in with SSO" (→ `/api/v1/auth/saml/login?next=`). Not sent by
   * the API yet (docs/api/tenant.md) — absent means off.
   */
  ssoEnabled?: boolean;
  /**
   * Platform capabilities switched off for every school (console → Feature availability) or missing their platform
   * connection: `live_classes`, `ai`, `community`, `certs`, `sso`, `signin_google`, … Their pages 404 and their links,
   * buttons and sign-in options are gone. The API already applies it to `oauth_providers`, `sso_enabled` and `features`.
   * Empty = everything available.
   */
  unavailable: string[];
  /** Plan entitlements the storefront reacts to. Enforced by the API too — this only hides UI. */
  features: {
    membership: boolean;
    community: boolean;
    certificates: boolean;
    streaks: boolean;
  };
  /* ── Site builder output: what is published to the website (the draft on a preview) ── */
  navigation: SiteNavigation;
  theme: SiteTheme;
  announcement: { text: string } | null;
  /** The school's favicon (`/api/v1/site/assets/{id}`), else null. */
  faviconUrl: string | null;
  /** The school's own `<head>` code, injected verbatim on every page. Null on previews and when empty. */
  headCode: string | null;
  /** Show the cookie consent banner (Settings → Privacy → Cookie banner). */
  cookieBanner: boolean;
  /**
   * Analytics tags, ad pixels and site-verification tokens (validated ids; all null on previews and from an older API).
   * Tags load once the visitor allows their consent category (features/tracking, docs/consent.md).
   */
  tracking: SiteTracking;
  /** `enabled && !unlocked` → the lock screen (with a password field when `password`). */
  siteLock: { enabled: boolean; unlocked: boolean; password: boolean };
  /** Public site-builder pages other than home (template pages excluded), in page order. */
  pages: { path: string; title: string }[];
  screens: {
    auth: AuthScreen | null;
    legal: { privacy: LegalScreen | null; terms: LegalScreen | null; refundPolicy: LegalScreen | null };
  };
}

/** Site fields that come from the site builder (the rest is branding, settings and entitlements). */
export type SiteBuilderFields =
  'navigation' | 'theme' | 'announcement' | 'faviconUrl' | 'headCode' | 'cookieBanner' | 'siteLock' | 'pages' | 'screens';
