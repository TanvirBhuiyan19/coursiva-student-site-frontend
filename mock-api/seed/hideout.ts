/**
 * Test tenant for the site lock: a school still building its site, locked behind a site password (`letmein`). Content
 * is Northwind's courses; the site is the starter. Not a demo school.
 */
import type { TenantData } from '../lib/records';
import { northwind } from './northwind';
import { hideoutSite } from './site';

export function hideout(): TenantData {
  const base = northwind();
  return {
    ...base,
    resolution: { ...base.resolution, tenant: 'hideout', primaryHost: 'hideout.localhost', indexable: false },
    site: {
      ...base.site,
      slug: 'hideout',
      name: 'Hideout Studio',
      legalName: 'Hideout Studio',
      primaryHost: 'hideout.localhost',
      whiteLabel: false,
      seo: { ...base.site.seo, title: 'Hideout Studio', indexable: false },
    },
    builder: hideoutSite(),
    privacy: { cookieBanner: false },
  };
}
