import 'server-only';
import type { Metadata } from 'next';
import { unstable_rethrow } from 'next/navigation';
import { cache } from 'react';
import { localizePath } from '@/i18n/locales';
import { apiGetOrNull, cacheTags } from '@/lib/api/server';
import { currentScope, getSite } from '@/features/tenant/server';
import { normalizeSeo, overrideFor, schemaAllowed } from './normalize';
import type { SchemaTypes, StorefrontSeo } from './types';

/**
 * The school's SEO settings (`GET /api/v1/seo`), cached with the site (`t:<slug>`: Laravel revalidates the whole tenant
 * on every SEO change). An older API, an error or a locked site reads as the defaults — SEO never breaks a page.
 */
export const getSeo = cache(async (tenant: string): Promise<StorefrontSeo> => {
  try {
    return normalizeSeo(await apiGetOrNull<StorefrontSeo>(tenant, '/seo', { tags: [cacheTags.site(tenant)] }));
  } catch (e) {
    unstable_rethrow(e);
    return normalizeSeo(null);
  }
});

/** Whether the page may add a structured data type (`schema_enabled` and the type's switch). */
export async function schemaOn(type: keyof SchemaTypes): Promise<boolean> {
  const { tenant } = await currentScope();
  return schemaAllowed(await getSeo(tenant), type);
}

/**
 * A page's metadata with the school's per-page override applied (by its locale-less app path): an overridden title
 * replaces the templated one, the description, canonical URL and share image replace the page's own, and a hidden
 * page (or a hidden site) gets `noindex`. Every indexable page type returns its metadata through this.
 */
export async function withSeo(path: string, meta: Metadata): Promise<Metadata> {
  const { tenant, locale } = await currentScope();
  const [seo, site] = await Promise.all([getSeo(tenant), getSite(tenant, locale)]);
  const o = overrideFor(seo, path);
  if (!o) return meta;
  const og = meta.openGraph ?? {};
  const tw = meta.twitter ?? {};
  const title = o.title ?? undefined;
  const description = o.description ?? undefined;
  const image = o.ogImageUrl ? [{ url: o.ogImageUrl, width: 1200, height: 630 }] : undefined;
  const canonical = o.canonicalUrl
    ? o.canonicalUrl.startsWith('/')
      ? localizePath(site, locale, o.canonicalUrl)
      : o.canonicalUrl
    : undefined;
  return {
    ...meta,
    ...(title ? { title: { absolute: title } } : {}),
    ...(description ? { description } : {}),
    ...(canonical ? { alternates: { ...meta.alternates, canonical } } : {}),
    openGraph: { ...og, ...(title ? { title } : {}), ...(description ? { description } : {}), ...(image ? { images: image } : {}) },
    twitter: { ...tw, ...(title ? { title } : {}), ...(description ? { description } : {}), ...(image ? { images: [o.ogImageUrl!] } : {}) },
    ...(o.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}
