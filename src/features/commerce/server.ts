import 'server-only';
import { cache } from 'react';
import { apiGetOrNull, cacheTags } from '@/lib/api/server';
import type { ProductPage } from './types';

/** A product's sales page; `null` when the storefront doesn't sell it (draft, service, physical, unknown). */
export const getProduct = cache((tenant: string, slug: string, locale?: string) =>
  apiGetOrNull<ProductPage>(tenant, `/products/${encodeURIComponent(slug)}`, {
    tags: [cacheTags.product(tenant, slug)],
    locale,
  }),
);
