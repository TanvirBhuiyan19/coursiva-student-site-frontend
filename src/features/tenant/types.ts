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
}

export type SocialNetwork = 'linkedin' | 'instagram' | 'youtube' | 'x' | 'facebook' | 'tiktok';

/** `GET /api/v1/site` — everything the chrome (header, footer, theme, SEO defaults) needs. Cached per tenant. */
export interface Site {
  slug: string;
  name: string;
  /** Legal name for the © line; usually equal to `name`. */
  legalName: string;
  /** One-line description (footer, default meta description). */
  tagline: string;
  logoUrl: string | null;
  /** White-label plans hide the "Powered by Coursiva" credit. */
  whiteLabel: boolean;
  brand: Brand;
  /** BCP 47, e.g. `en-US`. Drives formatting and the message catalogue. */
  locale: string;
  currency: string;
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
  /** Social sign-in providers the tenant enabled (Laravel Socialite). */
  oauthProviders: 'google'[];
  /** Plan entitlements the storefront reacts to. Enforced by the API too — this only hides UI. */
  features: {
    membership: boolean;
    community: boolean;
    certificates: boolean;
    streaks: boolean;
  };
}
