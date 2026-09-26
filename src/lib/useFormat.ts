import { useLocale, useTranslations } from 'next-intl';
import type { Money } from './api/types';
import { formatBytes, formatClock, formatDate, formatMoney, formatNumber, splitMinutes, timeAgo } from './format';

/**
 * Locale-aware formatters for components (works in Server Components that aren't async, and in Client Components).
 * Everything uses the tenant's locale from next-intl, so server HTML and client hydration agree.
 */
export function useFormat() {
  const locale = useLocale();
  const t = useTranslations('common');
  return {
    locale,
    money: (m: Money) => formatMoney(m, locale),
    number: (n: number) => formatNumber(n, locale),
    date: (iso: string) => formatDate(iso, locale),
    ago: (iso: string) => timeAgo(iso, locale),
    clock: formatClock,
    bytes: (b: number) => formatBytes(b, locale),
    duration: (minutes: number) => {
      const { h, m } = splitMinutes(minutes);
      return h && m ? t('duration.hm', { h, m }) : h ? t('duration.h', { h }) : t('duration.m', { m });
    },
  };
}
