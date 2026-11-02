'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';
import { useSchoolDateTime } from '@/lib/schoolTimeZone';
import { useFormat } from '@/lib/useFormat';
import { learningKeys } from '../api';
import { countdown, lockMessage, minutesSpent } from '../availability';
import type { LearnerCheckBlock, Lesson, LessonCompletion, LessonLock, LiveLessonSession, PlayerCourse } from '../types';
import styles from './LessonStatus.module.css';
import { VideoPlayer } from './VideoPlayer';

/**
 * Course builder v2 O4 in the player: why a lesson is locked, how a lesson completes (when it isn't a Complete click)
 * and a Live lesson's session. Every lock, unlock time and share comes from the API.
 */

/** The sentence for a lock: "Opens on …", "Opens in 3 days", "Complete “…” first", or the reason's own sentence. */
export function useLockText() {
  const t = useTranslations('player.lock');
  const schoolDateTime = useSchoolDateTime();
  return (lock: LessonLock, now: number = Date.now()) => {
    const m = lockMessage(lock, now);
    switch (m.key) {
      case 'date':
        return t('date', { date: schoolDateTime(m.unlocksAt) });
      case 'dripIn':
        return t('dripIn', { days: m.days });
      case 'afterItem':
        return t('afterItem', { title: m.title });
      default:
        return t(m.key);
    }
  };
}

/** A padlock (decorative). */
export function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/** The player's screen for a lesson the API refused with `403 lesson_locked`. */
export function LockedLesson({ lock, course, title }: { lock: LessonLock; course: PlayerCourse; title: string | null }) {
  const t = useTranslations('player');
  const text = useLockText();
  // `after` may name a lesson of this course (link to it) or a module (no page of its own).
  const target = lock.after && course.modules.some((m) => m.lessons.some((l) => l.id === lock.after!.id)) ? lock.after : null;
  return (
    <section className={styles.locked} aria-labelledby="locked-h">
      <LockIcon className={styles.lockIcon} />
      {title && <p className={styles.lockedFor}>{title}</p>}
      <h1 id="locked-h" className={styles.lockedTitle} tabIndex={-1}>
        {t('lockedTitle')}
      </h1>
      <p className={styles.lockedWhy}>{text(lock)}</p>
      {target && (
        <Link href={routes.player(course.slug, target.id)} className="btn btn-primary">
          {t('lockedGoTo', { title: target.title })}
        </Link>
      )}
    </section>
  );
}

/**
 * How a non-manual lesson completes, with its progress, or the done state. `lesson` supplies the knowledge checks
 * (answered / total) for the `checks` rule.
 */
export function CompletionStatus({ completion: c, lesson }: { completion: LessonCompletion; lesson: Lesson }) {
  const t = useTranslations('player.completion');
  if (c.done)
    return (
      <p className={`tag tag-ok ${styles.done}`} role="status">
        {t('done')}
      </p>
    );
  const checks = (lesson.blocks ?? []).filter((b): b is LearnerCheckBlock => b.type === 'check');
  const answered = checks.filter((b) => b.state !== null).length;
  const text =
    c.rule === 'video'
      ? t('video', { value: c.value ?? 100, progress: c.progress ?? 0 })
      : c.rule === 'time'
        ? t('time', { minutes: c.value ?? 0, spent: minutesSpent(c) })
        : c.rule === 'checks'
          ? (lesson.blocksLocked ?? 0) > 0
            ? t('checksMore', { answered })
            : t('checks', { answered, total: checks.length })
          : c.rule === 'quiz' || c.rule === 'assignment' || c.rule === 'live' || c.rule === 'scorm' || c.rule === 'survey'
            ? t(c.rule)
            : null;
  if (!text) return null;
  return (
    <div className={styles.completion} role="status">
      <p className={styles.completionText}>{text}</p>
      {c.progress !== null && (
        <div
          className="progress"
          role="progressbar"
          aria-valuenow={c.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('label')}
        >
          <span style={{ width: `${c.progress}%` }} />
        </div>
      )}
    </div>
  );
}

/** Ticks every `ms` so countdowns stay current. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** The join window opens shortly before the start: re-read the lesson then (and while live) to get `join_url`. */
const JOIN_WINDOW_MS = 20 * 60_000;

/** A Live lesson's session: when, how long, where, its status, Join while joinable and the recording once published. */
export function LiveLesson({ lessonId, live }: { lessonId: string; live: LiveLessonSession }) {
  const t = useTranslations('player.live');
  const f = useFormat();
  const schoolDateTime = useSchoolDateTime();
  const qc = useQueryClient();
  const now = useNow(30_000);
  const start = new Date(live.startsAt).getTime();
  const near = live.status === 'live' || (live.status === 'scheduled' && start - now < JOIN_WINDOW_MS);

  // Near the start (or while live) without a join link yet: check again every minute.
  useEffect(() => {
    if (!near || live.joinUrl) return;
    const timer = setInterval(() => void qc.invalidateQueries({ queryKey: learningKeys.lesson(lessonId) }), 60_000);
    return () => clearInterval(timer);
  }, [near, live.joinUrl, lessonId, qc]);

  const left = live.status === 'scheduled' ? countdown(live.startsAt, now) : null;
  return (
    <section className={styles.live} aria-labelledby="live-h">
      <div className={styles.liveHead}>
        <span className={`tag ${live.status === 'live' ? 'tag-brand' : 'tag-soft'}`}>{t(`status.${live.status}`)}</span>
        <h2 id="live-h" className={styles.liveTitle}>
          {live.title}
        </h2>
      </div>
      <p className={styles.liveMeta}>
        <time dateTime={live.startsAt}>{t('when', { date: schoolDateTime(live.startsAt), duration: f.duration(live.durationMin) })}</time>
        {' · '}
        {t('via', { provider: t(`providers.${live.provider}`) })}
      </p>
      {live.status === 'scheduled' && (
        <p className={styles.countdown}>
          {left === null
            ? t('startingSoon')
            : left.key === 'days'
              ? t('startsIn.days', { days: left.days, hours: left.hours })
              : left.key === 'hours'
                ? t('startsIn.hours', { hours: left.hours, minutes: left.minutes })
                : t('startsIn.minutes', { minutes: left.minutes })}
        </p>
      )}
      {live.joinUrl ? (
        <a href={live.joinUrl} className="btn btn-primary" target="_blank" rel="noopener noreferrer">
          {t('join')}
        </a>
      ) : (
        live.status !== 'ended' && <p className={styles.liveHint}>{t('joinHint')}</p>
      )}
      {live.recording ? (
        <div className={styles.recording}>
          <h3 className={styles.recordingTitle}>{t('recording')}</h3>
          <VideoPlayer video={live.recording} title={live.title} durationSeconds={null} reportLessonId={null} />
        </div>
      ) : (
        live.status === 'ended' && <p className={styles.liveHint}>{t('noRecording')}</p>
      )}
    </section>
  );
}
