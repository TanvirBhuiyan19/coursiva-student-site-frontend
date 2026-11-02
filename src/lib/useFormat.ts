import { useLocale, useTranslations } from 'next-intl';
import type { CoursePricing } from '@/features/catalog/types';
import type { Money } from './api/types';
import {
  formatBytes,
  formatClock,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatWeekday,
  splitMinutes,
  timeAgo,
} from './format';

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
    /**
     * A course's price as learners read it (cards, rows, the course page, the hero card): "Free" for a free course;
     * with its `pricing`, "$35/mo" for a subscription, "From $10" for pay what you want and "Members only" for a
     * course that comes with a membership.
     */
    coursePrice: (m: Money, pricing?: CoursePricing) => {
      if (pricing?.model === 'membership') return t('membersOnly');
      if (pricing?.model === 'pay_what_you_want' && pricing.minimumPrice)
        return pricing.minimumPrice.amount === 0
          ? t('payWhatYouWant')
          : t('fromPrice', { price: formatMoney(pricing.minimumPrice, locale) });
      if (m.amount === 0) return t('free');
      if (pricing?.model === 'subscription') return t('perMonth', { price: formatMoney(m, locale) });
      return formatMoney(m, locale);
    },
    number: (n: number) => formatNumber(n, locale),
    date: (iso: string) => formatDate(iso, locale),
    dateTime: (iso: string) => formatDateTime(iso, locale),
    weekday: (day: number) => formatWeekday(day, locale),
    ago: (iso: string) => timeAgo(iso, locale),
    clock: formatClock,
    bytes: (b: number) => formatBytes(b, locale),
    duration: (minutes: number) => {
      const { h, m } = splitMinutes(minutes);
      return h && m ? t('duration.hm', { h, m }) : h ? t('duration.h', { h }) : t('duration.m', { m });
    },
  };
}
