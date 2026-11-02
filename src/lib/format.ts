import type { Money } from './api/types';

/**
 * Formatting helpers shared by server and client code. Every helper takes the tenant locale explicitly — the
 * storefront renders in the tenant's locale, not the visitor's browser locale, so server and client HTML match.
 */

/** `$249`, `$1,299.50`, `£89`. Whole amounts drop the decimals, as in the design. */
export function formatMoney(m: Money, locale: string): string {
  const major = m.amount / 100;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(major);
}

/**
 * A typed money amount (`25`, `25.5`, `1,299.50`) → minor units, or null when it isn't one (negative, more than two
 * decimals, letters). Input handling only: the API prices and validates it.
 */
export function parseMoneyInput(text: string): number | null {
  const clean = text.replace(/[\s,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** Minor units → the plain amount a money field shows (`2500` → `25`, `2550` → `25.50`). */
export function toMoneyInput(m: Money): string {
  return m.amount % 100 === 0 ? String(m.amount / 100) : (m.amount / 100).toFixed(2);
}

export const formatNumber = (n: number, locale: string) => new Intl.NumberFormat(locale).format(n);

/** Lesson length as the player shows it: `4:12`, `1:02:05`. */
export function formatClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export const splitMinutes = (minutes: number) => ({ h: Math.floor(minutes / 60), m: minutes % 60 });

/** `Aug 12, 2026` in the tenant locale (UTC, so server and client agree). */
export const formatDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));

/**
 * `Oct 23, 2026, 11:59 PM` in the viewer's own time zone — for deadlines, which are instants. Only used in client-only
 * views (learner pages render after hydration), so there is no server/client mismatch.
 */
export const formatDateTime = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

/**
 * `Nov 10, 2026, 9:00 AM PST` in the school's time zone (`site.timeZone`) — lesson unlock times and live sessions,
 * which the school schedules in its own zone. Without one, the viewer's zone (no zone name, like `formatDateTime`).
 */
export const formatSchoolDateTime = (iso: string, locale: string, timeZone: string | null) =>
  timeZone
    ? new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone,
        timeZoneName: 'short',
      }).format(new Date(iso))
    : formatDateTime(iso, locale);

/** `Friday` for a weekday number (0 = Sunday). */
export const formatWeekday = (day: number, locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 1, 1 + (((day % 7) + 7) % 7))));

/** `1.2 MB` */
export function formatBytes(bytes: number, locale: string): string {
  const mb = bytes / 1_048_576;
  return mb >= 1
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mb)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Relative time: `2h ago`, `3 days ago`, in the tenant locale. */
export function timeAgo(iso: string, locale: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86_400 * 30) return rtf.format(Math.round(diff / 86_400), 'day');
  if (abs < 86_400 * 365) return rtf.format(Math.round(diff / (86_400 * 30)), 'month');
  return rtf.format(Math.round(diff / (86_400 * 365)), 'year');
}

/** Star string for a rating, e.g. 4 → `★★★★☆`. Decorative only — pair with an accessible label. */
export const stars = (rating: number) => '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating));
