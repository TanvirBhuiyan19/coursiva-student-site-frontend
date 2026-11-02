import { ApiError } from '@/lib/api/errors';
import type { LessonCompletion, LessonLock, LockAfter, PlayerLesson } from './types';

/**
 * Availability and completion copy for the player (course builder v2 O4). The API decides every lock, unlock time and
 * completion share; these helpers only pick the sentence and its values (formatting stays in the components).
 */

const isAfter = (v: unknown): v is LockAfter =>
  !!v && typeof v === 'object' && typeof (v as LockAfter).id === 'string' && typeof (v as LockAfter).title === 'string';

/** The lock of an outline entry, or null when the lesson is open. */
export function lockOf(l: PlayerLesson): LessonLock | null {
  if (!l.locked) return null;
  return { reason: l.lockReason ?? '', unlocksAt: l.unlocksAt ?? null, after: l.after ?? null };
}

/** The lock from a `403 lesson_locked { reason, unlocks_at, after }` answer to `GET /me/lessons/{id}`, else null. */
export function lockFromError(err: unknown): LessonLock | null {
  if (!(err instanceof ApiError) || err.status !== 403 || err.code !== 'lesson_locked') return null;
  const d = err.details;
  return {
    reason: err.reason ?? '',
    unlocksAt: typeof d.unlocksAt === 'string' ? d.unlocksAt : null,
    after: isAfter(d.after) ? d.after : null,
  };
}

/** Whole calendar days (in the viewer's time zone) from `now` to `iso`; 0 for today or the past. */
export function daysUntil(iso: string, now: number = Date.now()): number {
  const day = (ms: number) => {
    const d = new Date(ms);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  return Math.max(0, Math.round((day(new Date(iso).getTime()) - day(now)) / 86_400_000));
}

const FIXED = ['previous_module', 'previous_lesson', 'prerequisite', 'assignment_gate'] as const;

export type LockMessage =
  | { key: 'date'; unlocksAt: string }
  | { key: 'dripIn'; days: number }
  | { key: 'afterItem'; title: string }
  | { key: 'drip' | 'generic' | (typeof FIXED)[number] };

/** Which sentence explains a lock: `messages.player.lock.<key>`. */
export function lockMessage(lock: LessonLock, now: number = Date.now()): LockMessage {
  switch (lock.reason) {
    case 'date':
      return lock.unlocksAt ? { key: 'date', unlocksAt: lock.unlocksAt } : { key: 'generic' };
    case 'drip':
      return lock.unlocksAt ? { key: 'dripIn', days: daysUntil(lock.unlocksAt, now) } : { key: 'drip' };
    case 'after_item':
      return lock.after ? { key: 'afterItem', title: lock.after.title } : { key: 'prerequisite' };
    default:
      return (FIXED as readonly string[]).includes(lock.reason) ? { key: lock.reason as (typeof FIXED)[number] } : { key: 'generic' };
  }
}

/** "Starts in …": the parts of a countdown to `iso`, or null once it's due. */
export type Countdown =
  { key: 'days'; days: number; hours: number } | { key: 'hours'; hours: number; minutes: number } | { key: 'minutes'; minutes: number };

export function countdown(iso: string, now: number = Date.now()): Countdown | null {
  const ms = new Date(iso).getTime() - now;
  if (!(ms > 0)) return null;
  const minutesLeft = Math.ceil(ms / 60_000);
  const days = Math.floor(minutesLeft / 1440);
  const hours = Math.floor((minutesLeft % 1440) / 60);
  const minutes = minutesLeft % 60;
  if (days > 0) return { key: 'days', days, hours };
  if (hours > 0) return { key: 'hours', hours, minutes };
  return { key: 'minutes', minutes };
}

/** A time-rule lesson's minutes so far, from the API's share (or a heartbeat's seconds). */
export function minutesSpent(c: LessonCompletion): number {
  if (!c.value || c.progress === null) return 0;
  return Math.floor((c.progress * c.value) / 100);
}

/**
 * The completion after a heartbeat: the API answers `{ time_spent_sec, completed }`, the share is the seconds over the
 * rule's minutes (capped at 100).
 */
export function afterBeat(c: LessonCompletion, timeSpentSec: number, completed: boolean): LessonCompletion {
  const goal = (c.value ?? 0) * 60;
  const progress = completed ? 100 : goal > 0 ? Math.min(100, Math.floor((timeSpentSec / goal) * 100)) : c.progress;
  return { ...c, progress, done: c.done || completed };
}
