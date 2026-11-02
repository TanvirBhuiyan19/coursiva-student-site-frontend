/** The school's SEO as the storefront applies it. Contract: docs/api/pages.md → "SEO". */

/** Structured data (JSON-LD) types the school switched on. */
export interface SchemaTypes {
  organization: boolean;
  course: boolean;
  product: boolean;
  breadcrumbs: boolean;
  faq: boolean;
  article: boolean;
  person: boolean;
}

/** A page's override, by path (only pages the school overrode are listed). */
export interface SeoPageOverride {
  path: string;
  /** A full title (the title template is not applied again); null = the page's own. */
  title: string | null;
  description: string | null;
  noindex: boolean;
  inSitemap: boolean;
  /** A site path or an https:// URL; null = the page's own address. */
  canonicalUrl: string | null;
  ogImageUrl: string | null;
}

/** `GET /api/v1/seo`. */
export interface StorefrontSeo {
  /** Uses `{page}` and `{school}`, e.g. `{page} — {school}`. */
  titleTemplate: string;
  noindex: boolean;
  schemaEnabled: boolean;
  schemaTypes: SchemaTypes;
  /** The school's own robots.txt rules (the storefront adds the private-path Disallows and the Sitemap line). */
  robotsTxt: string;
  sitemap: { path: string; updatedAt: string | null }[];
  pages: SeoPageOverride[];
}

/** A redirect as the proxy holds it (`GET /api/v1/seo/redirects`, service token). */
export interface RedirectRule {
  id: string;
  /** A site path; ending in `/*` matches the path and everything under it. */
  from: string;
  /** A path or an http(s) URL; ending in `*` (prefix rules) carries the rest of the path over. */
  to: string;
  status: 301 | 302;
  keepQuery: boolean;
}
