/**
 * Live-session timing (pure, server-safe: no hooks). The join window is the backend's: from `joinOpensAt` (15 minutes
 * before the start) until the scheduled end plus the room's hour of grace; a session the host started is live
 * whatever the clock says.
 */

export const GRACE_MS = 60 * 60_000;

/**
 * - `later`: more than a day away; `soon`: within a day (a ticking countdown);
 * - `open`: inside the join window, not yet started ("Starting soon" + Join);
 * - `live`: the host started it; `ended`: it finished; `missed`: never started and its window closed.
 */
export type LivePhase = 'later' | 'soon' | 'open' | 'live' | 'ended' | 'missed';

export interface Timed {
  status: 'scheduled' | 'live' | 'ended';
  startsAt: string;
  endsAt: string;
  joinOpensAt: string;
}

export function livePhase(s: Timed, now: number): LivePhase {
  if (s.status === 'ended') return 'ended';
  if (s.status === 'live') return 'live';
  const start = Date.parse(s.startsAt);
  if (now > Date.parse(s.endsAt) + GRACE_MS) return 'missed';
  if (now >= Date.parse(s.joinOpensAt)) return 'open';
  return start - now <= 24 * 3600_000 ? 'soon' : 'later';
}

/** Whole days, hours, minutes and seconds until `ms` from `now` (zero once past). */
export function countdown(target: number, now: number) {
  const left = Math.max(0, target - now);
  const s = Math.floor(left / 1000);
  return { total: left, d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** The `YYYY-MM-DD` day of an instant in a zone (undefined = the viewer's), for grouping a schedule by day. */
export function dayKey(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** Whether an instant falls within the next 7 days (the "This week" filter). */
export const withinWeek = (iso: string, now: number) => Date.parse(iso) - now <= 7 * 86400_000;

/** A zone's readable name ("British Summer Time", else the IANA id) at an instant. */
export function zoneName(locale: string, timeZone: string | undefined, at = Date.now()): string {
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'long' })
      .formatToParts(new Date(at))
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return timeZone ?? 'UTC';
  }
}
