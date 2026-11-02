import { pathKey } from './rules';
import type { SchemaTypes, SeoPageOverride, StorefrontSeo } from './types';

/** Pure SEO helpers (no Next imports) shared by the server code, the route handlers and the tests. */

const ALL_ON: SchemaTypes = { organization: true, course: true, product: true, breadcrumbs: true, faq: true, article: true, person: true };

export const DEFAULT_SEO: StorefrontSeo = {
  titleTemplate: '{page} · {school}',
  noindex: false,
  schemaEnabled: true,
  schemaTypes: ALL_ON,
  robotsTxt: '',
  sitemap: [],
  pages: [],
};

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** A payload from any API version (or none) as a complete StorefrontSeo. */
export function normalizeSeo(raw: Partial<StorefrontSeo> | null | undefined): StorefrontSeo {
  if (!raw || typeof raw !== 'object') return DEFAULT_SEO;
  const types = (raw.schemaTypes ?? {}) as Partial<Record<keyof SchemaTypes, unknown>>;
  return {
    titleTemplate:
      typeof raw.titleTemplate === 'string' && raw.titleTemplate.includes('{page}') ? raw.titleTemplate : DEFAULT_SEO.titleTemplate,
    noindex: bool(raw.noindex, false),
    schemaEnabled: bool(raw.schemaEnabled, true),
    schemaTypes: Object.fromEntries(Object.keys(ALL_ON).map((k) => [k, types[k as keyof SchemaTypes] !== false])) as unknown as SchemaTypes,
    robotsTxt: typeof raw.robotsTxt === 'string' ? raw.robotsTxt : '',
    sitemap: Array.isArray(raw.sitemap)
      ? raw.sitemap.filter((u) => typeof u.path === 'string').map((u) => ({ path: u.path, updatedAt: text(u.updatedAt) }))
      : [],
    pages: Array.isArray(raw.pages)
      ? raw.pages
          .filter((p) => typeof p.path === 'string')
          .map((p) => ({
            path: p.path,
            title: text(p.title),
            description: text(p.description),
            noindex: bool(p.noindex, false),
            inSitemap: bool(p.inSitemap, true),
            canonicalUrl: text(p.canonicalUrl),
            ogImageUrl: text(p.ogImageUrl),
          }))
      : [],
  };
}

/** The school's override for a locale-less app path (`/home` is the home page `/`), or null. */
export function overrideFor(seo: StorefrontSeo, path: string): SeoPageOverride | null {
  const key = pathKey(path === '/home' ? '/' : path);
  return seo.pages.find((p) => pathKey(p.path === '/home' ? '/' : p.path) === key) ?? null;
}

/** Paths the sitemap must leave out: hidden pages and pages the school took out of it. */
export const unlisted = (seo: StorefrontSeo) => new Set(seo.pages.filter((p) => p.noindex || !p.inSitemap).map((p) => pathKey(p.path)));

export const schemaAllowed = (seo: StorefrontSeo, type: keyof SchemaTypes) => seo.schemaEnabled && seo.schemaTypes[type];

/**
 * Next's title template from the school's (`{page} — {school}` → `%s — Acme`). A `%s` in the school's name is broken up
 * so Next can't substitute into it.
 */
export function titleTemplate(template: string, school: string): string {
  return template.replaceAll('{school}', school.replaceAll('%s', '% s')).replace('{page}', '%s').replaceAll('{page}', '');
}

/** Which switch governs a JSON-LD node, by its `@type` (null = always allowed). */
export function schemaTypeOf(type: unknown): keyof SchemaTypes | null {
  switch (type) {
    case 'Organization':
    case 'EducationalOrganization':
    case 'WebSite':
      return 'organization';
    case 'Course':
    case 'ItemList': // the catalogue's course list
      return 'course';
    case 'Product':
      return 'product';
    case 'BreadcrumbList':
      return 'breadcrumbs';
    case 'FAQPage':
      return 'faq';
    case 'Article':
    case 'BlogPosting':
      return 'article';
    case 'Person':
    case 'ProfilePage':
    case 'CollectionPage': // the instructors index
      return 'person';
    default:
      return null;
  }
}

/**
 * Serialises JSON-LD for a `<script type="application/ld+json">`: `<`, `>`, `&` and the JS line separators are
 * escaped, so school-authored text can never close the script tag or break out of it.
 */
export const jsonLdText = (data: unknown) =>
  JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replaceAll(String.fromCharCode(0x2028), '\\u2028')
    .replaceAll(String.fromCharCode(0x2029), '\\u2029');
