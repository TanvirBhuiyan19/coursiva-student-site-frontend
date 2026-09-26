'use client';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/toast/Toaster';
import { useSession } from '@/features/auth/api';
import { useRsvp } from '@/features/community/api';
import { useFormat } from '@/lib/useFormat';
import { downloadIcs } from '../calendar';
import type { LiveEvent } from '../types';
import styles from './Dashboard.module.css';

/**
 * Next live session. Provider-aware: BYO Zoom/Meet/Teams opens the provider with the learner's personal link;
 * the built-in room joins in the browser. Times show in the learner's own timezone.
 */
export function LiveBanner({ event, organizer }: { event: LiveEvent; organizer: string }) {
  const t = useTranslations('learning');
  const f = useFormat();
  const toast = useToast();
  const { user } = useSession();
  const rsvp = useRsvp();
  const tz = user?.timezone;
  const start = new Date(event.startsAt);
  const day = new Intl.DateTimeFormat(f.locale, { weekday: 'long', timeZone: tz }).format(start);
  const time = new Intl.DateTimeFormat(f.locale, { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(start);
  const embedded = event.provider === 'built_in';
  const provider = t(`providers.${event.provider}`);

  return (
    <section className={styles.live} aria-label={t('liveLabel')}>
      <p className={styles.liveTag}>
        <span className={styles.liveDot} aria-hidden="true" />
        {t('liveDay', { day })}
      </p>
      <p className={styles.liveTitle}>
        {event.title} · <time dateTime={event.startsAt}>{time}</time>
      </p>
      <span className={styles.liveVia}>{embedded ? t('inBrowser') : t('opensIn', { provider })}</span>
      <button
        type="button"
        className="btn btn-outline btn-sm"
        onClick={() => {
          downloadIcs(event, organizer);
          toast(t('calendarDone'));
        }}
      >
        {t('addToCalendar')}
      </button>
      <button
        type="button"
        className={`btn btn-sm ${event.going ? 'btn-success' : 'btn-outline'}`}
        aria-pressed={event.going}
        disabled={rsvp.isPending}
        onClick={() => rsvp.mutate({ eventId: event.id, going: !event.going })}
      >
        {event.going ? t('going', { count: event.attendees }) : t('rsvp', { count: event.attendees })}
      </button>
      {event.joinUrl && (
        <a
          href={event.joinUrl}
          className="btn btn-primary btn-sm"
          target={embedded ? undefined : '_blank'}
          rel="noopener noreferrer"
          onClick={() => toast(embedded ? t('joiningBrowser') : t('joiningProvider', { provider }))}
        >
          {embedded ? t('joinHere') : t('joinIn', { provider })}
        </a>
      )}
    </section>
  );
}
