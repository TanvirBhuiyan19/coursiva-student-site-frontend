'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';
import { formatCountdown, formatWhen } from '../format';
import type { LearnerBooking } from '../types';
import styles from './Bookings.module.css';

/**
 * Checkout of a service with a held time: what is held and how long is left (paying within it confirms the time).
 * Once the hold ends the time may go to someone else; paying still buys the session, to book afterwards.
 */
export function HoldNotice({ hold }: { hold: LearnerBooking }) {
  const t = useTranslations('bookings');
  const locale = useLocale();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = hold.holdExpiresAt ? Date.parse(hold.holdExpiresAt) - now : 0;
  const when = formatWhen(hold.startsAt, locale, hold.timezone);

  if (left <= 0)
    return (
      <div className={`alert alert-bad ${styles.hold}`} role="alert">
        <p>
          {t('holdExpired', { when })} {hold.product.slug && <Link href={routes.product(hold.product.slug)}>{t('pickNewTime')}</Link>}
        </p>
      </div>
    );
  return (
    <div className={`alert alert-ok ${styles.hold}`}>
      <p>
        <b>{t('holdTitle')}</b>
      </p>
      <p>{t('holdBody', { title: hold.product.title, when, left: formatCountdown(left) })}</p>
    </div>
  );
}
