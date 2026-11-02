import 'server-only';
import { cache } from 'react';
import { apiGet, apiGetOrNull, cacheTags } from '@/lib/api/server';
import type { CertificateVerification, HelpArticle, HelpCategory, LegalDocument } from './types';

export const getHelp = cache((tenant: string, locale?: string) =>
  apiGet<HelpCategory[]>(tenant, '/help', { tags: [cacheTags.content(tenant)], locale }),
);

/** One help article (`null` = unknown, unpublished, or an API without help articles yet). */
export const getHelpArticle = cache((tenant: string, slug: string, locale?: string) =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 80
    ? apiGetOrNull<HelpArticle>(tenant, `/help/articles/${slug}`, { tags: [cacheTags.content(tenant)], locale })
    : Promise.resolve(null),
);

export const getLegal = cache((tenant: string, doc: LegalDocument['slug'], locale?: string) =>
  apiGetOrNull<LegalDocument>(tenant, `/legal/${doc}`, { tags: [cacheTags.content(tenant)], locale }),
);

/** The public registry record behind `/verify/{code}`. Cached a minute: revocations show up quickly. */
export const getCertificateVerification = cache((tenant: string, code: string) =>
  /^[A-Z0-9]{1,3}-\d{4}-\d{4,9}$/.test(code)
    ? apiGetOrNull<CertificateVerification>(tenant, `/registry/certificates/${encodeURIComponent(code)}`, { revalidate: 60 })
    : Promise.resolve(null),
);
