/**
 * Service products and 1:1 bookings — the mock's port of the backends' availability (spec §3), race-safe reserve
 * (§4), learner rules (§5), checkout fulfilment (§6) and cancel effects (§7). State lives beside the tenant (seeded
 * from seed/bookings.ts on first use, fresh after every reset).
 */
import type { ProductPage } from '@/features/commerce/types';
import type { BookingCredit, IntakeQuestion, LearnerBooking, LocationType } from '@/features/bookings/types';
import { addDays, localDate, weekdayOf, zonedTimeToUtc, type Weekday } from '@/lib/timezone';
import { bookingSeed } from '../seed/bookings';
import { money } from './present';
import type { OrderRow, TenantData, UserRow } from './records';

export const MIN = 60_000;
export const DAY = 24 * 60 * MIN;
export const HOLD_MINUTES = 15;
export const MAX_RESCHEDULES = 3;
export const TAKEN = 'That time was just taken. Pick another time.';

export type Interval = [string, string];

export interface HostRow {
  id: string;
  userId: string;
  name: string;
  timezone: string;
  weekly: Record<Weekday, Interval[]>;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMin: number;
  maxDaysAhead: number;
  dailyCap: number | null;
  active: boolean;
  overrides: { date: string; intervals: Interval[] }[];
  timeOff: { startsAt: string; endsAt: string }[];
}

export interface ServiceRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** Minor units, for the whole purchase (all `sessions`). */
  price: number;
  status: 'published' | 'draft';
  sessionMinutes: number;
  sessions: number;
  bookingWindowDays: number;
  hostIds: string[];
  location: { type: LocationType; detail: string };
  intakeQuestions: IntakeQuestion[];
  cancelNoticeHours: number;
}

export interface PackageRow {
  id: string;
  userId: string;
  productId: string;
  orderId: string | null;
  sessionsTotal: number;
  sessionsUsed: number;
  status: 'active' | 'refunded';
  createdAt: string;
}

export interface BookingRow {
  id: string;
  productId: string;
  productTitle: string;
  hostId: string;
  userId: string;
  packageId: string | null;
  status: 'held' | 'confirmed' | 'cancelled' | 'no_show' | 'expired';
  startsAt: string;
  endsAt: string;
  timezone: string;
  holdExpiresAt: string | null;
  slotKey: string | null;
  locationType: LocationType;
  locationDetail: string | null;
  phone: string | null;
  answers: { key: string; label: string; value: string }[];
  meeting: { joinUrl: string } | null;
  roomName: string | null;
  sequence: number;
  rescheduleCount: number;
  cancelReason: string | null;
  cancelledBy: 'learner' | 'staff' | 'system' | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface BookingState {
  hosts: HostRow[];
  services: ServiceRow[];
  packages: PackageRow[];
  bookings: BookingRow[];
}

const states = new WeakMap<TenantData, BookingState>();

export function bookingState(t: TenantData): BookingState {
  let s = states.get(t);
  if (!s) {
    s = bookingSeed(t.site.slug, Date.now());
    states.set(t, s);
  }
  return s;
}

let seq = 5000;
export const bookingId = (prefix: 'bk' | 'bp') => `${prefix}_${(seq++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

export const activeHosts = (s: BookingState, service: ServiceRow) =>
  service.hostIds.flatMap((id) => {
    const h = s.hosts.find((x) => x.id === id);
    return h?.active ? [h] : [];
  });

/** A published service with at least one active host (else the storefront treats it as unknown). */
export function sellableService(t: TenantData, slug: string): ServiceRow | null {
  const s = bookingState(t);
  const service = s.services.find((x) => x.slug === slug && x.status === 'published');
  return service && activeHosts(s, service).length ? service : null;
}

export const serviceById = (t: TenantData, id: string) => bookingState(t).services.find((x) => x.id === id) ?? null;

/** Holds the slot: confirmed and no-show sessions, and holds that haven't expired. */
export const isActive = (b: BookingRow, now: number) =>
  b.status === 'confirmed' || b.status === 'no_show' || (b.status === 'held' && !!b.holdExpiresAt && Date.parse(b.holdExpiresAt) > now);

/** §3 for one host: bookable starts (ms) in [fromMs, toMs). `excludeId` = the booking being moved. */
export function hostSlots(
  s: BookingState,
  service: ServiceRow,
  host: HostRow,
  fromMs: number,
  toMs: number,
  now: number,
  excludeId: string | null = null,
): number[] {
  const step = Math.min(service.sessionMinutes, 30) * MIN;
  const dur = service.sessionMinutes * MIN;
  const earliest = now + host.minNoticeMin * MIN;
  const latest = now + Math.min(host.maxDaysAhead, service.bookingWindowDays) * DAY;
  const lo = Math.max(fromMs, earliest);
  const hi = Math.min(toMs, latest + 1);
  if (lo >= hi) return [];
  const tz = host.timezone;
  const active = s.bookings.filter((b) => b.hostId === host.id && b.id !== excludeId && isActive(b, now));
  const out: number[] = [];
  const last = addDays(localDate(hi, tz), 1);
  for (let date = addDays(localDate(lo, tz), -1); date <= last; date = addDays(date, 1)) {
    const intervals = host.overrides.find((o) => o.date === date)?.intervals ?? host.weekly[weekdayOf(date)];
    for (const [start, end] of intervals) {
      const S = zonedTimeToUtc(date, start, tz);
      const E = zonedTimeToUtc(date, end, tz);
      for (let t = S; t + dur <= E; t += step) {
        if (t < lo || t >= hi) continue;
        if (host.timeOff.some((o) => Date.parse(o.startsAt) < t + dur && Date.parse(o.endsAt) > t)) continue;
        const a = t - host.bufferBeforeMin * MIN;
        const z = t + dur + host.bufferAfterMin * MIN;
        if (active.some((b) => Date.parse(b.startsAt) < z && Date.parse(b.endsAt) > a)) continue;
        if (host.dailyCap !== null) {
          const day = localDate(t, tz);
          if (active.filter((b) => localDate(Date.parse(b.startsAt), tz) === day).length >= host.dailyCap) continue;
        }
        out.push(t);
      }
    }
  }
  return out;
}

/** §3: the union over the service's active hosts, deduped by start, sorted. */
export function serviceSlots(
  s: BookingState,
  service: ServiceRow,
  fromMs: number,
  toMs: number,
  now: number,
  excludeId: string | null = null,
) {
  const all = new Set<number>();
  for (const h of activeHosts(s, service)) for (const t of hostSlots(s, service, h, fromMs, toMs, now, excludeId)) all.add(t);
  return [...all].sort((a, b) => a - b);
}

/** The site's availability response: slots grouped by the learner's local date (only days with slots). */
export function availabilityFor(s: BookingState, service: ServiceRow, from: string, days: number, timezone: string, now: number) {
  const fromMs = zonedTimeToUtc(from, '00:00', timezone);
  const toMs = zonedTimeToUtc(addDays(from, days), '00:00', timezone);
  const grouped: { date: string; slots: { startsAt: string; endsAt: string }[] }[] = [];
  for (const t of serviceSlots(s, service, fromMs, toMs, now)) {
    const date = localDate(t, timezone);
    let day = grouped.at(-1);
    if (day?.date !== date) {
      day = { date, slots: [] };
      grouped.push(day);
    }
    day.slots.push({ startsAt: iso(t), endsAt: iso(t + service.sessionMinutes * MIN) });
  }
  return { timezone, slotMinutes: service.sessionMinutes, days: grouped };
}

const dayLoad = (s: BookingState, host: HostRow, t: number, now: number) => {
  const day = localDate(t, host.timezone);
  return s.bookings.filter((b) => b.hostId === host.id && isActive(b, now) && localDate(Date.parse(b.startsAt), host.timezone) === day)
    .length;
};

export interface ReserveInput {
  user: UserRow;
  mode: 'hold' | 'confirm';
  timezone: string;
  answers?: BookingRow['answers'];
  phone?: string | null;
  packageId?: string | null;
  /** Moving (reschedule) or re-reserving (after payment) this booking: it is excluded and updated in place. */
  existing?: BookingRow;
}

/**
 * §4 reserve: candidate hosts free at `t`, fewest active bookings that local day first (then id); for each, expire
 * its stale holds and claim the slot key. Null = taken (409 for the caller).
 */
export function reserve(s: BookingState, service: ServiceRow, t: number, now: number, r: ReserveInput): BookingRow | null {
  const exclude = r.existing?.id ?? null;
  const candidates = activeHosts(s, service)
    .filter((h) => hostSlots(s, service, h, t, t + 1, now, exclude).includes(t))
    .sort((a, b) => dayLoad(s, a, t, now) - dayLoad(s, b, t, now) || a.id.localeCompare(b.id));
  for (const host of candidates) {
    for (const b of s.bookings)
      if (b.hostId === host.id && b.status === 'held' && b.holdExpiresAt && Date.parse(b.holdExpiresAt) <= now) {
        b.status = 'expired';
        b.slotKey = null;
      }
    if (!hostSlots(s, service, host, t, t + 1, now, exclude).includes(t)) continue;
    const key = `${host.id}|${Math.floor(t / 1000)}`;
    if (s.bookings.some((b) => b.slotKey === key && b.id !== exclude)) continue;
    const fields = {
      hostId: host.id,
      startsAt: iso(t),
      endsAt: iso(t + service.sessionMinutes * MIN),
      status: r.mode === 'hold' ? ('held' as const) : ('confirmed' as const),
      holdExpiresAt: r.mode === 'hold' ? iso(now + HOLD_MINUTES * MIN) : null,
      slotKey: key,
      timezone: r.timezone,
    };
    if (r.existing) {
      Object.assign(r.existing, fields, { sequence: r.existing.sequence + 1 });
      if (r.packageId !== undefined) r.existing.packageId = r.packageId;
      return r.existing;
    }
    const b: BookingRow = {
      id: bookingId('bk'),
      productId: service.id,
      productTitle: service.title,
      userId: r.user.id,
      packageId: r.packageId ?? null,
      locationType: service.location.type,
      locationDetail: service.location.detail || null,
      phone: r.phone ?? null,
      answers: r.answers ?? [],
      meeting: null,
      roomName: null,
      sequence: 0,
      rescheduleCount: 0,
      cancelReason: null,
      cancelledBy: null,
      cancelledAt: null,
      createdAt: iso(now),
      ...fields,
    };
    if (service.location.type === 'video') b.roomName = `bk-${b.id}`;
    if (['zoom', 'meet', 'teams'].includes(service.location.type)) b.meeting = { joinUrl: `https://meet.example.com/${b.id}` };
    s.bookings.push(b);
    return b;
  }
  return null;
}

/** Sessions left on a learner's active package of this product (oldest package with credit first). */
export const creditPackage = (s: BookingState, userId: string, productId: string) =>
  s.packages
    .filter((p) => p.userId === userId && p.productId === productId && p.status === 'active' && p.sessionsUsed < p.sessionsTotal)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null;

export function credits(t: TenantData, userId: string): BookingCredit[] {
  const s = bookingState(t);
  return s.packages.flatMap((p) => {
    const service = s.services.find((x) => x.id === p.productId);
    const remaining = p.sessionsTotal - p.sessionsUsed;
    return p.userId === userId && p.status === 'active' && remaining > 0 && service
      ? [{ productSlug: service.slug, productTitle: service.title, remaining, total: p.sessionsTotal, packageId: p.id }]
      : [];
  });
}

const ONLINE = new Set<LocationType>(['video', 'zoom', 'meet', 'teams']);
export const isOnline = (type: LocationType) => ONLINE.has(type);

/** The learner's view of the status: a confirmed session that has ended is `completed`; a lapsed hold is `expired`. */
export function learnerStatus(b: BookingRow, now: number): LearnerBooking['status'] {
  if (b.status === 'confirmed' && Date.parse(b.endsAt) <= now) return 'completed';
  if (b.status === 'held' && (!b.holdExpiresAt || Date.parse(b.holdExpiresAt) <= now)) return 'expired';
  return b.status;
}

/** Before the policy cut-off (`cancel_notice_hours` before the start). */
export const withinPolicy = (b: BookingRow, service: ServiceRow | null, now: number) =>
  now <= Date.parse(b.startsAt) - (service?.cancelNoticeHours ?? 24) * 60 * MIN;

export function presentBooking(t: TenantData, b: BookingRow, now: number): LearnerBooking {
  const s = bookingState(t);
  const service = s.services.find((x) => x.id === b.productId) ?? null;
  const host = s.hosts.find((h) => h.id === b.hostId);
  const status = learnerStatus(b, now);
  const start = Date.parse(b.startsAt);
  return {
    id: b.id,
    status,
    product: { slug: service?.slug ?? null, title: b.productTitle },
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    timezone: b.timezone,
    host: { name: host?.name ?? '' },
    location: { type: b.locationType, detail: isOnline(b.locationType) ? null : b.locationDetail },
    joinAvailable: status === 'confirmed' && isOnline(b.locationType) && now >= start - 15 * MIN && now < Date.parse(b.endsAt),
    holdExpiresAt: status === 'held' ? b.holdExpiresAt : null,
    canCancel: status === 'held' || (status === 'confirmed' && withinPolicy(b, service, now)),
    canReschedule: status === 'confirmed' && withinPolicy(b, service, now) && b.rescheduleCount < MAX_RESCHEDULES,
    cancelNoticeHours: service?.cancelNoticeHours ?? 24,
    cancelReason: b.cancelReason,
    answers: b.answers,
  };
}

/** The public sales page of a service. */
export function servicePage(t: TenantData, service: ServiceRow): ProductPage {
  return {
    slug: service.slug,
    kind: 'service',
    title: service.title,
    description: service.description,
    thumbnailUrl: null,
    price: money(t, service.price),
    compareAtPrice: null,
    file: null,
    delivery: null,
    courses: [],
    service: {
      sessionMinutes: service.sessionMinutes,
      sessions: service.sessions,
      locationType: service.location.type,
      intakeQuestions: service.intakeQuestions,
      cancelNoticeHours: service.cancelNoticeHours,
    },
  };
}

/** The checkout line's meta ("1:1 session · 60 min", "Package of 5 sessions · 45 min each"). */
export const serviceMeta = (service: ServiceRow) =>
  service.sessions > 1
    ? `Package of ${service.sessions} sessions · ${service.sessionMinutes} min each`
    : `1:1 session · ${service.sessionMinutes} min`;

/**
 * §6 fulfilment of a paid order's service lines (idempotent per order): a package of `sessions` credits, then the
 * learner's latest held (or lapsed) time of that product from the last 24 h is re-reserved and confirmed with one
 * credit. A time someone else took meanwhile → the booking expires (the "Choose a time" mail in the backends).
 */
export function fulfilBookings(t: TenantData, user: UserRow, order: OrderRow, now = Date.now()) {
  const s = bookingState(t);
  for (const item of order.items) {
    if (item.kind !== 'product') continue;
    const service = s.services.find((x) => x.id === item.refId);
    if (!service || s.packages.some((p) => p.orderId === order.id && p.productId === service.id)) continue;
    const pkg: PackageRow = {
      id: bookingId('bp'),
      userId: user.id,
      productId: service.id,
      orderId: order.id,
      sessionsTotal: service.sessions,
      sessionsUsed: 0,
      status: 'active',
      createdAt: iso(now),
    };
    s.packages.push(pkg);
    const pending = s.bookings
      .filter(
        (b) =>
          b.userId === user.id &&
          b.productId === service.id &&
          !b.packageId &&
          (b.status === 'held' || b.status === 'expired') &&
          Date.parse(b.createdAt) >= now - DAY,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!pending) continue;
    const moved = reserve(s, service, Date.parse(pending.startsAt), now, {
      user,
      mode: 'confirm',
      timezone: pending.timezone,
      packageId: pkg.id,
      existing: pending,
    });
    if (moved) pkg.sessionsUsed += 1;
    else {
      pending.status = 'expired';
      pending.slotKey = null;
      pending.holdExpiresAt = pending.holdExpiresAt ?? iso(now);
    }
  }
}

/** RFC 5545 text escaping and 75-octet folding (CRLF line ends). */
const icsText = (v: string) => v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let size = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = '';
      size = 0;
    }
    cur += ch;
    size += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}
const icsTime = (isoTime: string) => isoTime.replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** §9 ICS for the learner (`calendar.ics`): UID `{id}@{host}`, SEQUENCE, LOCATION = the join page for online sessions. */
export function bookingIcs(t: TenantData, b: BookingRow, now: number): string {
  const s = bookingState(t);
  const host = s.hosts.find((h) => h.id === b.hostId)?.name ?? '';
  const site = `https://${t.site.primaryHost}`;
  const page = `${site}/account/bookings/${b.id}`;
  const cancelled = b.status === 'cancelled' || b.status === 'expired';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Coursiva//Bookings//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${b.id}@${t.site.primaryHost}`,
    `SEQUENCE:${b.sequence}`,
    `DTSTAMP:${icsTime(iso(now))}`,
    `DTSTART:${icsTime(b.startsAt)}`,
    `DTEND:${icsTime(b.endsAt)}`,
    `SUMMARY:${icsText(`${b.productTitle} with ${host}`)}`,
    `LOCATION:${icsText(isOnline(b.locationType) ? page : (b.locationDetail ?? ''))}`,
    `DESCRIPTION:${icsText(`Your session with ${host}. Details, join, reschedule or cancel: ${page}`)}`,
    `URL:${page}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
