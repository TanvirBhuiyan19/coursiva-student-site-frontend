/**
 * Time-zone helpers on top of `Intl` (no library): local dates and wall-clock times in an IANA zone, DST-correct.
 * Used by the booking slot picker (formatting only — slots come from the API) and by the mock API's availability.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** An IANA zone name the runtime knows (`Europe/London`, `UTC`); offsets and abbreviations are refused. */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  if (tz !== 'UTC' && !/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(tz)) return false;
  try {
    partsFormatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock fields of an instant in a zone. */
export function zonedParts(ms: number, tz: string) {
  const p: Record<string, number> = {};
  for (const part of partsFormatter(tz).formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return { year: p.year!, month: p.month!, day: p.day!, hour: p.hour! % 24, minute: p.minute!, second: p.second! };
}

/** The zone's offset from UTC at an instant, in ms (positive east of Greenwich). */
export function zoneOffsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant of a local date and time (`HH:MM`, `24:00` = the next day's midnight) in a zone. A time skipped by a
 * DST jump lands after the jump (02:30 on a spring-forward night → 03:30).
 */
export function zonedTimeToUtc(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const o1 = zoneOffsetMs(wall, tz);
  const t = wall - o1;
  const o2 = zoneOffsetMs(t, tz);
  if (o2 === o1) return t;
  const t2 = wall - o2;
  return zoneOffsetMs(t2, tz) === o2 ? t2 : t;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of an instant in a zone. */
export function localDate(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** A calendar date plus `n` days (`YYYY-MM-DD`). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** `mon`…`sun` for a calendar date. */
export function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** Every IANA zone the runtime lists (plus `extra`, e.g. the detected zone when it's an alias), sorted. */
export function timeZoneList(extra: (string | null | undefined)[] = []): string[] {
  const listed = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [...new Set([...listed, 'UTC', ...extra.filter((z): z is string => !!z && isTimeZone(z))])].sort();
}

/** The browser's zone, or null when it reports none usable. */
export function detectTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isTimeZone(tz) ? tz : null;
  } catch {
    return null;
  }
}
