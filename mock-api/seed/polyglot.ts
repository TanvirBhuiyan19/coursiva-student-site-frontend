/**
 * Test tenant for multi-language routing: English (default), Spanish and Arabic (RTL). Content is Amplify's — the mock
 * does not translate content; it exercises locale URLs, hreflang, <html lang/dir> and message fallback. Not a demo school.
 */
import type { TenantData } from '../lib/records';
import { amplify } from './amplify';

export function polyglot(): TenantData {
  const base = amplify();
  const locales = ['en-US', 'es-ES', 'ar'];
  return {
    ...base,
    resolution: {
      tenant: 'polyglot',
      primaryHost: 'polyglot.localhost',
      status: 'active',
      indexable: true,
      defaultLocale: 'en-US',
      locales,
    },
    site: {
      ...base.site,
      slug: 'polyglot',
      name: 'Polyglot Academy',
      legalName: 'Polyglot Academy',
      primaryHost: 'polyglot.localhost',
      defaultLocale: 'en-US',
      locales,
      seo: { ...base.site.seo, title: 'Polyglot Academy — courses in three languages' },
    },
  };
}
