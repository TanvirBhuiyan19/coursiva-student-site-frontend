import { getRequestConfig } from 'next-intl/server';
import { currentTenant, getSite } from '@/features/tenant/server';

/**
 * UI copy comes from messages/<lang>.json; the language is the tenant's locale (a learner site has one language, set
 * in the dashboard). Tenant content — course titles, page sections — arrives already written from the API.
 * Read via `next/root-params`, so pages stay statically renderable.
 */
const catalogues = {
  en: () => import('../../messages/en.json'),
} as const;

export default getRequestConfig(async () => {
  const site = await getSite(await currentTenant());
  const lang = site.locale.split('-')[0] ?? 'en';
  const load = lang in catalogues ? catalogues[lang as keyof typeof catalogues] : catalogues.en;
  const messages = (await load()).default;
  return { locale: site.locale, messages, timeZone: 'UTC' };
});
