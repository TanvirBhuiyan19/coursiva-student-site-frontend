import 'server-only';
import { cache } from 'react';
import { apiGetOrNull, cacheTags } from '@/lib/api/server';
import type { PublicWebinar } from './types';

/**
 * A public webinar for the server-rendered page (title, time, description, price: what search engines and link
 * previews read). Cached briefly — seats left and the form token are re-read in the browser (`useWebinar`).
 */
export const getWebinar = cache((tenant: string, slug: string, locale?: string) =>
  apiGetOrNull<PublicWebinar>(tenant, `/webinars/${encodeURIComponent(slug)}`, {
    tags: [cacheTags.webinar(tenant, slug)],
    revalidate: 60,
    locale,
  }),
);
