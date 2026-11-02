'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { Icon } from '@/components/icons';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { useLiveSchedule, useScheduleRsvp } from '../api';
import { dayKey, livePhase, withinWeek, zoneName } from '../timing';
import type { LiveScheduleItem, LiveScope } from '../types';
import { CalendarSubscribe } from './CalendarSubscribe';
import { Countdown, useNow } from './Countdown';
import styles from './LiveSchedule.module.css';

type Filter = 'upcoming' | 'week' | 'going' | 'recordings';
const FILTERS: Filter[] = ['upcoming', 'week', 'going', 'recordings'];
const scopeOf = (f: Filter): LiveScope => (f === 'week' ? 'upcoming' : f);

/**
 * `/live`: the learner's live classes — every upcoming session from their courses and the community spaces they can
 * read, grouped by day in their own time zone, with RSVP and the way in right on the row; their RSVPs; and past
 * sessions with a replay. The side panel subscribes their calendar to everything they RSVP to.
 */
export function LiveScheduleView() {
  const t = useTranslations('liveSchedule');
  const [filter, setFilter] = useState<Filter>('upcoming');
  const q = useLiveSchedule(scopeOf(filter));
  const now = useNow(30_000);
  const first = q.data?.pages[0];
  const tz = first?.timezone ?? undefined;
  const rows = useMemo(() => {
    const all = q.data?.pages.flatMap((p) => p.sessions) ?? [];
    return filter === 'week' ? all.filter((s) => withinWeek(s.startsAt, now)) : all;
  }, [q.data, filter, now]);

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <div className={styles.toolbar}>
          <div className={styles.filters} role="group" aria-label={t('filtersLabel')}>
            {FILTERS.map((f) => (
              <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {t(`filters.${f}`)}
              </button>
            ))}
          </div>
          <TimeZoneLine timeZone={tz} />
        </div>

        {q.isPending ? (
          <div className={styles.list} aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 112, borderRadius: 16 }} />
            ))}
          </div>
        ) : q.isError ? (
          <div className="alert alert-bad" role="alert">
            {q.error instanceof ApiError && q.error.status === 404 ? t('unavailable') : t('error')}{' '}
            <button type="button" className="link-btn" onClick={() => void q.refetch()}>
              {t('retry')}
            </button>
          </div>
        ) : rows.length === 0 ? (
          <Empty filter={filter} />
        ) : (
          <DayGroups rows={rows} timeZone={tz} now={now} past={filter === 'recordings'} />
        )}

        {q.hasNextPage && filter !== 'week' && (
          <button
            type="button"
            className={`btn btn-outline ${styles.more}`}
            disabled={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            {q.isFetchingNextPage ? t('loading') : t('showMore')}
          </button>
        )}
      </div>
      <aside className={styles.side} aria-label={t('sideLabel')}>
        <CalendarSubscribe />
        <section className={`card ${styles.howCard}`} aria-labelledby="live-how">
          <h2 id="live-how" className={styles.sideTitle}>
            {t('howTitle')}
          </h2>
          <ul className={styles.howList}>
            <li>{t('how1')}</li>
            <li>{t('how2')}</li>
            <li>{t('how3')}</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}

const noSubscribe = () => () => undefined;

/** "Times are in British Summer Time" — the learner's profile zone, else the browser's. */
export function TimeZoneLine({ timeZone }: { timeZone?: string }) {
  const t = useTranslations('liveSchedule');
  const locale = useLocale();
  // The browser's zone is only known on the client: null on the server, so server and client HTML agree.
  const name = useSyncExternalStore(
    noSubscribe,
    () => zoneName(locale, timeZone),
    () => null,
  );
  return (
    <p className={styles.tz} data-testid="live-timezone">
      <Icon name="clock" size={14} />
      <span>{name ? t('timeZone', { zone: name }) : ' '}</span>
      <Link href={`${routes.account}#preferences`} className={styles.tzLink}>
        {t('changeZone')}
      </Link>
    </p>
  );
}

function DayGroups({ rows, timeZone, now, past }: { rows: LiveScheduleItem[]; timeZone?: string; now: number; past: boolean }) {
  const t = useTranslations('liveSchedule');
  const locale = useLocale();
  const groups = useMemo(() => {
    const out: { key: string; items: LiveScheduleItem[] }[] = [];
    for (const r of rows) {
      const key = dayKey(r.startsAt, timeZone);
      const last = out.at(-1);
      if (last?.key === key) last.items.push(r);
      else out.push({ key, items: [r] });
    }
    return out;
  }, [rows, timeZone]);
  const today = dayKey(new Date(now).toISOString(), timeZone);
  const tomorrow = dayKey(new Date(now + 86400_000).toISOString(), timeZone);

  return (
    <div className={styles.list}>
      {groups.map((g) => {
        const label =
          g.key === today
            ? t('today')
            : g.key === tomorrow
              ? t('tomorrow')
              : new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone }).format(
                  new Date(g.items[0]!.startsAt),
                );
        return (
          <section key={g.key} className={styles.day} aria-label={label}>
            <h2 className={styles.dayTitle}>{label}</h2>
            <ul className={styles.rows}>
              {g.items.map((s) => (
                <li key={s.id}>
                  <SessionRow s={s} timeZone={timeZone} now={now} past={past} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function SessionRow({
  s,
  timeZone,
  now,
  past = false,
  compact = false,
}: {
  s: LiveScheduleItem;
  timeZone?: string;
  now: number;
  past?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations('liveSchedule');
  const tl = useTranslations('live');
  const locale = useLocale();
  const rsvp = useScheduleRsvp();
  const tt = useTranslations('liveTickets');
  const phase = livePhase(s, now);
  const start = new Date(s.startsAt);
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
  const range = `${time.format(start)} – ${time.format(new Date(s.endsAt))}`;
  const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone }).format(start);
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone }).format(start);
  const builtIn = s.provider === 'built_in';
  const canJoin = s.going && !!s.joinUrl && (phase === 'open' || phase === 'live');
  const provider = tl(`providers.${s.provider}`);

  return (
    <article className={styles.row} data-phase={phase} data-compact={compact || undefined} aria-labelledby={`live-${s.id}`}>
      <div className={styles.date} aria-hidden="true">
        <span className={styles.month}>{month}</span>
        <span className={styles.dayNum}>{day}</span>
      </div>
      <div className={styles.body}>
        <div className={styles.status}>
          <PhaseBadge phase={phase} startsAt={s.startsAt} now={now} past={past} />
          {s.waitlisted && <span className="tag tag-warn">{t('waitlisted')}</span>}
          {s.going && phase !== 'ended' && (
            <span className="tag tag-good">
              <Icon name="check" size={11} /> {t('going')}
            </span>
          )}
        </div>
        <h3 id={`live-${s.id}`} className={styles.title}>
          <Link href={routes.live(s.id)} className={styles.titleLink}>
            {s.title}
          </Link>
        </h3>
        <p className={styles.meta}>
          <span>
            <time dateTime={s.startsAt}>{range}</time> · {t('minutes', { count: s.durationMin })}
          </span>
          <span className={styles.via}>
            <Icon name={builtIn ? 'video' : 'external'} size={13} /> {builtIn ? t('inBrowser') : provider}
          </span>
          {!compact && (s.course ?? s.space) && <span className={styles.from}>{s.course?.title ?? s.space?.name}</span>}
        </p>
      </div>
      <div className={styles.actions}>
        {past || phase === 'ended' ? (
          s.hasReplay ? (
            <Link href={routes.live(s.id)} className="btn btn-primary btn-sm">
              <Icon name="play" size={13} /> {t('watchReplay')}
            </Link>
          ) : (
            <Link href={routes.live(s.id)} className="btn btn-outline btn-sm">
              {t('details')}
            </Link>
          )
        ) : canJoin ? (
          builtIn ? (
            <Link href={routes.liveRoom(s.id)} className="btn btn-primary btn-sm">
              {phase === 'live' ? tl('joinNow') : tl('openRoom')}
            </Link>
          ) : (
            <a href={s.joinUrl!} className="btn btn-primary btn-sm" target="_blank" rel="noopener noreferrer">
              {tl('joinWith', { provider })}
            </a>
          )
        ) : s.going || s.waitlisted ? (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={rsvp.isPending || phase === 'missed'}
            onClick={() => rsvp.mutate({ eventId: s.id, going: false })}
            aria-label={t('cancelFor', { title: s.title })}
          >
            {tl('cancelRsvp')}
          </button>
        ) : s.ticket && !s.ticket.hasAccess ? (
          /* Track F: a paid or members-only session without a seat — its page has the ticket / membership options. */
          <Link href={routes.live(s.id)} className="btn btn-primary btn-sm" aria-label={tt('ticketFor', { title: s.title })}>
            {s.ticket.access === 'members' ? tt('membersOnly') : tt('getTicket')}
          </Link>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={rsvp.isPending || phase === 'missed'}
            onClick={() => rsvp.mutate({ eventId: s.id, going: true })}
            aria-label={t('rsvpFor', { title: s.title })}
          >
            {tl('rsvp')}
          </button>
        )}
      </div>
    </article>
  );
}

function PhaseBadge({ phase, startsAt, now, past }: { phase: string; startsAt: string; now: number; past: boolean }) {
  const t = useTranslations('liveSchedule');
  if (past || phase === 'ended') return <span className="tag tag-soft">{t('phase.ended')}</span>;
  if (phase === 'live')
    return (
      <span className={`tag tag-bad ${styles.liveTag}`}>
        <span className={styles.pulse} aria-hidden="true" />
        {t('phase.live')}
      </span>
    );
  if (phase === 'open') return <span className="tag tag-warn">{t('phase.open')}</span>;
  if (phase === 'missed') return <span className="tag tag-soft">{t('phase.missed')}</span>;
  if (phase === 'soon')
    return (
      <span className="tag tag-soft">
        <Countdown target={Date.parse(startsAt)} now={now} />
      </span>
    );
  return null;
}

function Empty({ filter }: { filter: Filter }) {
  const t = useTranslations('liveSchedule');
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden="true">
        <Icon name="calendar" size={26} />
      </span>
      <h2 className="h3">{t(`empty.${filter}.title`)}</h2>
      <p className="muted">{t(`empty.${filter}.body`)}</p>
      {filter !== 'recordings' && (
        <Link href={routes.learning} className="btn btn-outline btn-sm">
          {t('toLearning')}
        </Link>
      )}
    </div>
  );
}
