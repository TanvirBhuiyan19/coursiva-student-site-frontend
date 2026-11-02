'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Icon } from '@/components/icons';
import { useToast } from '@/components/toast/Toaster';
import { useSession } from '@/features/auth/api';
import { downloadIcs, type Organizer } from '@/features/learning/calendar';
import { VideoPlayer } from '@/features/learning/components/VideoPlayer';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';
import { useSessionRsvp } from '../api';
import { livePhase } from '../timing';
import type { LiveSession } from '../types';
import { Countdown, useNow } from './Countdown';
import { LiveReplayRecap } from './LiveReplayRecap';
import { LiveTicketCta } from './LiveTicketCta';
import { TimeZoneLine } from './LiveSchedule';
import styles from './Live.module.css';

/**
 * `/live/{id}` (invite, reminder and recap e-mails link here): when (in the learner's zone, with a countdown), what,
 * RSVP, add to calendar and the way in — which opens 15 minutes before the start. Once it ends, the replay plays right
 * here for registrants and the course's learners (signed playback, the course media rules), with the AI recap when
 * the school shares one.
 */
export function SessionDetails({ s, organizer }: { s: LiveSession; organizer: Organizer }) {
  const t = useTranslations('live');
  const ts = useTranslations('liveSchedule');
  const locale = useLocale();
  const toast = useToast();
  const rsvp = useSessionRsvp(s.id);
  const now = useNow(1000);
  // The learner's own zone (profile), else the browser's: `/me` reports an unset zone as UTC, so UTC means "not set".
  const pref = useSession().user?.timezone;
  const timeZone = pref && pref !== 'UTC' ? pref : undefined;
  const phase = livePhase(s, now);
  const builtIn = s.provider === 'built_in';
  const provider = t(`providers.${s.provider}`);
  const start = new Date(s.startsAt);
  const date = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone }).format(start);
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
  const range = `${time.format(start)} – ${time.format(new Date(s.endsAt))}`;
  const joinable = s.going && !!s.joinUrl && (phase === 'open' || phase === 'live');
  const upcoming = phase === 'later' || phase === 'soon';

  return (
    <article className={styles.card} aria-labelledby="live-title">
      <div className={styles.badges}>
        <p className={styles.badge} data-status={phase === 'open' ? 'open' : s.status}>
          {phase === 'open' ? ts('phase.open') : phase === 'missed' ? ts('phase.missed') : t(`status.${s.status}`)}
        </p>
        {s.waitlisted && <span className="tag tag-warn">{ts('waitlisted')}</span>}
        {s.going && s.status !== 'ended' && (
          <span className="tag tag-good">
            <Icon name="check" size={11} /> {ts('going')}
          </span>
        )}
      </div>
      <h1 id="live-title" className="h1-sm">
        {s.title}
      </h1>
      <dl className={styles.facts}>
        <div>
          <dt>
            <Icon name="calendar" size={15} />
            <span className="sr-only">{t('dateLabel')}</span>
          </dt>
          <dd>
            <time dateTime={s.startsAt}>{date}</time>
          </dd>
        </div>
        <div>
          <dt>
            <Icon name="clock" size={15} />
            <span className="sr-only">{t('timeLabel')}</span>
          </dt>
          <dd>
            {range} · {ts('minutes', { count: s.durationMin })}
          </dd>
        </div>
        <div>
          <dt>
            <Icon name={builtIn ? 'video' : 'external'} size={15} />
            <span className="sr-only">{t('whereLabel')}</span>
          </dt>
          <dd>
            {t('where', { provider })}
            {/* "Be the first to join" only makes sense before it ends. */}
            {s.status !== 'ended' && phase !== 'missed' && <> · {t('attendees', { count: s.attendees })}</>}
          </dd>
        </div>
        {(s.course ?? s.space) && (
          <div>
            <dt>
              <Icon name={s.course ? 'play' : 'users'} size={15} />
              <span className="sr-only">{t('fromLabel')}</span>
            </dt>
            <dd>
              {s.course ? (
                <Link href={routes.course(s.course.slug)} className={styles.inlineLink}>
                  {s.course.title}
                </Link>
              ) : (
                <Link href={`${routes.community}?space=${encodeURIComponent(s.space!.id)}`} className={styles.inlineLink}>
                  {s.space!.name}
                </Link>
              )}
            </dd>
          </div>
        )}
      </dl>
      <TimeZoneLine timeZone={timeZone} />

      {s.status !== 'ended' && phase !== 'missed' && (
        <div className={styles.when} data-phase={phase}>
          {phase === 'live' ? (
            <p className={styles.whenText}>
              <span className={styles.liveDot} aria-hidden="true" /> {t('liveNowNote')}
            </p>
          ) : phase === 'open' ? (
            <p className={styles.whenText}>{t('openNote')}</p>
          ) : (
            <p className={styles.whenText}>
              <Countdown target={start.getTime()} now={now} />
              <span className={styles.whenSub}>{t('joinOpensAt', { time: time.format(new Date(s.joinOpensAt)) })}</span>
            </p>
          )}
        </div>
      )}

      {s.status !== 'ended' && phase !== 'missed' && (
        <div className={styles.actions}>
          {joinable ? (
            builtIn ? (
              <Link href={routes.liveRoom(s.id)} className="btn btn-primary btn-lg">
                {s.status === 'live' ? t('joinNow') : t('openRoom')}
              </Link>
            ) : (
              <a href={s.joinUrl!} className="btn btn-primary btn-lg" rel="noopener noreferrer" target="_blank">
                {t('joinWith', { provider })}
              </a>
            )
          ) : s.going ? (
            upcoming && (
              <button type="button" className="btn btn-primary btn-lg" disabled aria-describedby="live-join-hint">
                {t('joinSoon')}
              </button>
            )
          ) : s.waitlisted ? null : s.ticket && !s.ticket.hasAccess ? (
            /* Track F: a paid or members-only session without a seat — buy a ticket / join a membership. */
            <LiveTicketCta sessionId={s.id} ticket={s.ticket} />
          ) : (
            <button type="button" className="btn btn-primary btn-lg" disabled={rsvp.isPending} onClick={() => rsvp.mutate(true)}>
              {t('rsvp')}
            </button>
          )}
          {(s.going || s.waitlisted) && (
            <>
              {s.going && (
                <button
                  type="button"
                  className="btn btn-outline btn-lg"
                  onClick={() => {
                    downloadIcs(s, organizer);
                    toast(t('calendarDownloaded'));
                  }}
                >
                  <Icon name="calendar" size={15} /> {t('addToCalendar')}
                </button>
              )}
              {s.going && s.calendar && (
                <span className={styles.calLinks}>
                  <a href={s.calendar.google} target="_blank" rel="noopener noreferrer" className={styles.inlineLink}>
                    {t('googleCalendar')}
                  </a>
                  <a href={s.calendar.outlook} target="_blank" rel="noopener noreferrer" className={styles.inlineLink}>
                    {t('outlookCalendar')}
                  </a>
                </span>
              )}
              <button type="button" className="link-btn" disabled={rsvp.isPending} onClick={() => rsvp.mutate(false)}>
                {s.waitlisted ? t('leaveWaitlist') : t('cancelRsvp')}
              </button>
            </>
          )}
        </div>
      )}
      {s.going && upcoming && (
        <p id="live-join-hint" className={styles.meta}>
          {t('joinHint')}
        </p>
      )}
      {s.waitlisted && s.status !== 'ended' && <p className={styles.meta}>{t('waitlistNote')}</p>}
      {phase === 'missed' && <p className={styles.meta}>{t('missedNote')}</p>}

      {s.status === 'ended' && <Replay s={s} />}
      {/* The published AI recap next to the replay (Track D: LiveReplayRecap; nothing until the school shares one). */}
      {s.status === 'ended' && <LiveReplayRecap session={s} />}

      <p className={styles.back}>
        <Link href={routes.liveSchedule} className={styles.inlineLink}>
          {t('allSessions')}
        </Link>
      </p>
    </article>
  );
}

/** The replay once the session ended: the recording, or why there isn't one (never a dead end). */
function Replay({ s }: { s: LiveSession }) {
  const t = useTranslations('live.replay');
  const box = useRef<HTMLDivElement>(null);
  const replay = s.replay;

  // Chapters in the AI recap jump the player (`live:seek`, Track D's seekReplay), and mark its <video> for it.
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const mark = () => el.querySelector('video')?.setAttribute('data-live-replay', '');
    const observer = new MutationObserver(mark);
    observer.observe(el, { childList: true, subtree: true });
    mark();
    const onSeek = (e: Event) => {
      const video = el.querySelector('video');
      const seconds = (e as CustomEvent<{ seconds: number }>).detail.seconds;
      if (video && !video.hasAttribute('data-live-replay') && typeof seconds === 'number') video.currentTime = seconds;
    };
    document.addEventListener('live:seek', onSeek);
    return () => {
      observer.disconnect();
      document.removeEventListener('live:seek', onSeek);
    };
  }, []);

  if (replay?.status === 'available' && replay.video)
    return (
      <section className={styles.replay} aria-labelledby="live-replay-title">
        <h2 id="live-replay-title" className="h3">
          {t('title')}
        </h2>
        <div ref={box} data-testid="live-replay">
          <VideoPlayer video={replay.video} title={s.title} durationSeconds={s.durationMin * 60} reportLessonId={null} />
        </div>
      </section>
    );

  // `available` without a playable file reads as no recording.
  const status = !replay || replay.status === 'available' ? 'none' : replay.status;
  return (
    <div className={styles.replayNote} data-testid="live-replay-note" data-status={status}>
      <Icon name={status === 'processing' ? 'clock' : status === 'restricted' ? 'lock' : 'video'} size={18} />
      <div>
        <p className={styles.replayNoteTitle}>{t(`${status}.title`)}</p>
        <p className={styles.meta}>{t(`${status}.body`)}</p>
        {s.course && status !== 'processing' && (
          <Link href={routes.course(s.course.slug)} className={styles.inlineLink}>
            {t('toCourse', { course: s.course.title })}
          </Link>
        )}
      </div>
    </div>
  );
}
