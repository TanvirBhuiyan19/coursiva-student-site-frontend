'use client';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';
import { useLiveSchedule } from '../api';
import { useNow } from './Countdown';
import { SessionRow } from './LiveSchedule';
import styles from './LiveSchedule.module.css';

/**
 * The learning dashboard's "Upcoming live classes": the next three sessions from the learner's courses and spaces,
 * with RSVP and the way in on each row, and a link to the full schedule. Nothing at all when none is coming up.
 */
export function UpcomingLive({ className }: { className?: string }) {
  const t = useTranslations('liveSchedule');
  const q = useLiveSchedule('upcoming', 3);
  const now = useNow(30_000);
  const page = q.data?.pages[0];
  if (!page || page.sessions.length === 0) return null;
  const tz = page.timezone ?? undefined;
  return (
    <section className={`${styles.widget} ${className ?? ''}`} aria-labelledby="live-widget-t" data-testid="upcoming-live">
      <div className={styles.widgetHead}>
        <h2 id="live-widget-t" className="h2" style={{ fontSize: 22 }}>
          {t('widgetTitle')}
        </h2>
        <Link href={routes.liveSchedule} className={styles.widgetLink}>
          {t('seeAll')} →
        </Link>
      </div>
      <ul className={styles.rows}>
        {page.sessions.map((s) => (
          <li key={s.id}>
            <SessionRow s={s} timeZone={tz} now={now} compact />
          </li>
        ))}
      </ul>
    </section>
  );
}
