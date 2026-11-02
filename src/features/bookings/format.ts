/**
 * Booking times as the learner reads them: always in an explicit zone (the one they picked, or the booking's), so the
 * same instant shows the same wall-clock time on every device. Formatting only — slots come from the API.
 */

const dt = (locale: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options);

/** `1:00 PM` — a slot's start in `timeZone`. */
export const formatSlotTime = (iso: string, locale: string, timeZone: string) =>
  dt(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));

/** `Sun, Oct 25` — a calendar date (`YYYY-MM-DD`, already local to the learner). */
export const formatDay = (date: string, locale: string) =>
  dt(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

/** `Sunday, October 25` */
export const formatDayLong = (date: string, locale: string) =>
  dt(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

/** `Sun, Oct 25, 1:00 PM GMT` — a session's start with its zone. */
export const formatWhen = (iso: string, locale: string, timeZone: string) =>
  dt(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(new Date(iso));

/** `1:00 – 2:00 PM` */
export const formatRange = (startIso: string, endIso: string, locale: string, timeZone: string) =>
  dt(locale, { hour: 'numeric', minute: '2-digit', timeZone }).formatRange(new Date(startIso), new Date(endIso));

/** `Sunday, October 25, 2026` — the session's local date in `timeZone`. */
export const formatSessionDate = (iso: string, locale: string, timeZone: string) =>
  dt(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone }).format(new Date(iso));

/** `3:07` — minutes and seconds left on a hold. */
export const formatCountdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
