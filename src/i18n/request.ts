import { getRequestConfig } from 'next-intl/server';
import { env } from '@/config/env';
import { currentScope } from '@/features/tenant/server';
import { loadMessages } from './messages';

/**
 * UI copy for the request's locale — the `[locale]` root segment the proxy derived from the URL (`/es/…`, or the
 * tenant default when unprefixed). Tenant content (course titles, page sections) arrives translated from the API.
 */
export default getRequestConfig(async () => {
  const { locale } = await currentScope();
  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: 'UTC',
    // A missing key falls back to English in loadMessages; only a key missing everywhere reaches here.
    onError: (error) => {
      if (env.isDev) console.error(error);
    },
    getMessageFallback: ({ namespace, key }) => [namespace, key].filter(Boolean).join('.'),
  };
});
