import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { tenant as tenantParam } from 'next/root-params';
import { env } from '@/config/env';
import { apiGetOrNull, cacheTags } from '@/lib/api/server';
import type { Site } from './types';

/** The current tenant's slug — the root `[tenant]` segment the proxy rewrote the request into. */
export async function currentTenant(): Promise<string> {
  const slug = await tenantParam();
  if (!slug) notFound();
  return slug;
}

/** Site config for the chrome, theme and SEO defaults. Cached per tenant; `t:<slug>:site` revalidates it. */
export const getSite = cache(async (tenant: string): Promise<Site> => {
  const site = await apiGetOrNull<Site>(tenant, '/site', { tags: [cacheTags.site(tenant)] });
  if (!site) notFound();
  return site;
});

export const getCurrentSite = async () => getSite(await currentTenant());

/** Absolute URL on the tenant's canonical host (sitemaps, JSON-LD, OG tags). */
export const absoluteUrl = (site: Site, path = '/') => `${siteOrigin(site)}${path === '/' ? '' : path}`;

/** Local dev hosts (*.localhost) are plain http on the dev port; every real tenant host is https. */
export const siteOrigin = (site: Site) =>
  site.primaryHost.endsWith('.localhost') ? `http://${site.primaryHost}:${env.PORT}` : `https://${site.primaryHost}`;
