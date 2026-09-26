import 'server-only';
import { cache } from 'react';
import { apiGet, apiGetOrNull, cacheTags } from '@/lib/api/server';
import type { HelpCategory, LegalDocument } from './types';

export const getHelp = cache((tenant: string, locale?: string) =>
  apiGet<HelpCategory[]>(tenant, '/help', { tags: [cacheTags.content(tenant)], locale }),
);

export const getLegal = cache((tenant: string, doc: LegalDocument['slug'], locale?: string) =>
  apiGetOrNull<LegalDocument>(tenant, `/legal/${doc}`, { tags: [cacheTags.content(tenant)], locale }),
);
