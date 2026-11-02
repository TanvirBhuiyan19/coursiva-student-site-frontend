import 'server-only';
import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { locale as localeParam, tenant as tenantParam } from 'next/root-params';
import { env } from '@/config/env';
import { localizePath } from '@/i18n/locales';
import { apiGetOrNull, cacheTags } from '@/lib/api/server';
import { normalizeSite } from './normalize';
import type { Site } from './types';

/**
 * Request scope: the tenant and locale the proxy rewrote the request into (`/{tenant}/{locale}/…`, root params).
 * Server reads take both, so every cache entry is per tenant *and* per language.
 */
export interface Scope {
  tenant: string;
  locale: string;
}

/** The current tenant's slug (root `[tenant]` segment). */
export async function currentTenant(): Promise<string> {
  const slug = await tenantParam();
  if (!slug) notFound();
  return slug;
}

/**
 * Tenant + locale for this request. The locale comes from the URL via the proxy and is checked against the languages
 * the tenant publishes, so an unknown locale is a 404 rather than a page in the wrong language.
 */
export const currentScope = cache(async (): Promise<Scope> => {
  const [tenant, locale] = await Promise.all([currentTenant(), localeParam()]);
  if (!locale) notFound();
  const site = await getSite(tenant, locale);
  if (!site.locales.includes(locale)) notFound();
  return { tenant, locale };
});

/**
 * Site config for the chrome, theme and SEO defaults, in the requested language (tenant copy such as the tagline can
 * be translated). Cached per tenant and locale; `t:<slug>:site` revalidates it.
 */
export const getSite = cache(async (tenant: string, locale?: string): Promise<Site> => {
  const site = await apiGetOrNull<Site>(tenant, '/site', { tags: [cacheTags.site(tenant)], locale });
  if (!site) notFound();
  // An older or partial (cached) payload renders with safe defaults instead of failing every page.
  return normalizeSite(site);
});

export const getCurrentSite = async () => {
  const { tenant, locale } = await currentScope();
  return getSite(tenant, locale);
};

/** Local dev hosts (*.localhost) are plain http on the dev port; every real tenant host is https. */
export const siteOrigin = (site: Site) =>
  site.primaryHost.endsWith('.localhost') ? `http://${site.primaryHost}:${env.PORT}` : `https://${site.primaryHost}`;

/** Base URL for absolute links in the current language: `https://learn.acme.com` or `https://learn.acme.com/es`. */
export const localeBase = (site: Site, locale: string) => `${siteOrigin(site)}${localizePath(site, locale, '/').replace(/^\/$/, '')}`;

/**
 * Canonical + hreflang alternates for a locale-less app path (`/courses/x`). With one language this is just the
 * canonical URL; once a tenant publishes more, every page automatically lists its translations and an x-default.
 */
export async function pageAlternates(path: string): Promise<{ alternates: NonNullable<Metadata['alternates']>; url: string }> {
  const { tenant, locale } = await currentScope();
  const site = await getSite(tenant, locale);
  const url = localizePath(site, locale, path);
  if (site.locales.length < 2) return { alternates: { canonical: url }, url };
  const languages: Record<string, string> = Object.fromEntries(site.locales.map((l) => [l, localizePath(site, l, path)]));
  languages['x-default'] = localizePath(site, site.defaultLocale, path);
  return { alternates: { canonical: url, languages }, url };
}
