/**
 * Service products and 1:1 bookings (docs/api/commerce.md → Service products, docs/api/account.md → Bookings): the
 * public availability, booking a time, and the learner's sessions. Rules live in ../lib/bookings.ts.
 */
import { Hono } from 'hono';
import type { MyBookings } from '@/features/bookings/types';
import { isTimeZone, localDate } from '@/lib/timezone';
import { type AppContext, type Env, requireUser } from '../lib/db';
import { apiError, invalid, notFound, ok } from '../lib/http';
import {
  MAX_RESCHEDULES,
  MIN,
  TAKEN,
  availabilityFor,
  bookingIcs,
  bookingState,
  creditPackage,
  credits,
  isActive,
  isOnline,
  learnerStatus,
  presentBooking,
  reserve,
  sellableService,
  serviceById,
  withinPolicy,
  type BookingRow,
} from '../lib/bookings';
import { siteLocked } from './site';
import { issueCreditNote } from '../lib/tax';

export const bookingRoutes = new Hono<Env>();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

/** The raw JSON body: intake answers are keyed by the school's question keys, which must not be case-converted. */
async function rawBody(c: AppContext): Promise<Record<string, unknown>> {
  try {
    const b: unknown = await c.req.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** `starts_at`: an ISO instant. Returns the ms or an error message. */
function instant(v: unknown): number | string {
  if (v === undefined || v === null || v === '') return 'The starts at field is required.';
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v) || Number.isNaN(Date.parse(v)))
    return 'The starts at field must be a valid date.';
  return Date.parse(v);
}

const taken = (c: AppContext) => apiError(c, 409, TAKEN, 'conflict');

/** Public: open times grouped by the learner's local date. Never cached (a slot can go at any moment). */
bookingRoutes.get('/products/:slug/availability', (c: AppContext) => {
  const locked = siteLocked(c);
  if (locked) return locked;
  const t = c.get('t');
  const service = sellableService(t, c.req.param('slug') ?? '');
  if (!service) return notFound(c, 'Product');
  const tz = c.req.query('timezone') ?? '';
  if (!isTimeZone(tz)) return invalid(c, { timezone: 'Choose a valid time zone.' });
  const now = Date.now();
  const from = c.req.query('from') || localDate(now, tz);
  if (!DATE.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00Z`)))
    return invalid(c, { from: 'The from field must be a valid date.' });
  const daysQ = c.req.query('days');
  const days = daysQ === undefined || daysQ === '' ? 14 : Number(daysQ);
  if (!Number.isInteger(days) || days < 1 || days > 31) return invalid(c, { days: 'The days field must be between 1 and 31.' });
  c.header('Cache-Control', 'no-store');
  return ok(c, availabilityFor(bookingState(t), service, from, days, tz, now));
});

/** Book a time: with a credit or free → confirmed; otherwise held 15 minutes for checkout. */
bookingRoutes.post('/products/:slug/bookings', requireUser, async (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const service = sellableService(t, c.req.param('slug') ?? '');
  if (!service) return notFound(c, 'Product');
  const s = bookingState(t);
  const b = await rawBody(c);
  const errors: Record<string, string> = {};
  const start = instant(b.starts_at);
  if (typeof start === 'string') errors.startsAt = start;
  if (!isTimeZone(b.timezone)) errors.timezone = 'Choose a valid time zone.';
  const answersIn = b.answers ?? {};
  const answers: BookingRow['answers'] = [];
  if (typeof answersIn !== 'object' || answersIn === null || Array.isArray(answersIn))
    errors.answers = 'The answers field must be an object.';
  else
    for (const q of service.intakeQuestions) {
      const v: unknown = (answersIn as Record<string, unknown>)[q.key];
      const text = typeof v === 'string' ? v.trim() : '';
      if (text.length > 2000) errors[`answers.${q.key}`] = `The answers.${q.key} field must not be greater than 2000 characters.`;
      else if (q.required && !text) errors[`answers.${q.key}`] = `Answer “${q.label}”.`;
      else if (text) answers.push({ key: q.key, label: q.label, value: text });
    }
  const phone = typeof b.phone === 'string' ? b.phone.trim() : '';
  if (service.location.type === 'phone' && !phone) errors.phone = 'Add the phone number we should call.';
  else if (phone.length > 40) errors.phone = 'The phone field must not be greater than 40 characters.';
  if (Object.keys(errors).length || typeof start === 'string') return invalid(c, errors);
  const timezone = b.timezone as string;
  const now = Date.now();
  const reserveInput = { user, timezone, answers, phone: service.location.type === 'phone' ? phone : null };

  const pkg = creditPackage(s, user.id, service.id);
  if (pkg) {
    const booking = reserve(s, service, start, now, { ...reserveInput, mode: 'confirm', packageId: pkg.id });
    if (!booking) return taken(c);
    pkg.sessionsUsed += 1;
    return ok(c, { booking: presentBooking(t, booking, now), next: 'confirmed' }, 201);
  }
  if (service.price === 0) {
    const upcoming = s.bookings.some(
      (x) => x.userId === user.id && x.productId === service.id && !x.packageId && isActive(x, now) && Date.parse(x.endsAt) > now,
    );
    if (upcoming) return invalid(c, { startsAt: 'You already have an upcoming session booked.' });
    const booking = reserve(s, service, start, now, { ...reserveInput, mode: 'confirm' });
    if (!booking) return taken(c);
    return ok(c, { booking: presentBooking(t, booking, now), next: 'confirmed' }, 201);
  }
  // A new hold replaces the learner's other holds of this product.
  for (const x of s.bookings)
    if (x.userId === user.id && x.productId === service.id && x.status === 'held') {
      x.status = 'expired';
      x.slotKey = null;
    }
  const booking = reserve(s, service, start, now, { ...reserveInput, mode: 'hold' });
  if (!booking) return taken(c);
  return ok(
    c,
    {
      booking: presentBooking(t, booking, now),
      next: 'checkout',
      checkoutUrlPath: `/checkout?product=${encodeURIComponent(service.slug)}`,
    },
    201,
  );
});

bookingRoutes.get('/me/bookings', requireUser, (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const now = Date.now();
  const mine = bookingState(t).bookings.filter((b) => b.userId === user.id);
  const upcoming = mine
    .filter((b) => (b.status === 'confirmed' && Date.parse(b.endsAt) > now) || (b.status === 'held' && isActive(b, now)))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const shown = new Set(upcoming.map((b) => b.id));
  const past = mine
    .filter((b) => !shown.has(b.id) && b.status !== 'held' && b.status !== 'expired')
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, 50);
  const data: MyBookings = {
    upcoming: upcoming.map((b) => presentBooking(t, b, now)),
    past: past.map((b) => presentBooking(t, b, now)),
    credits: credits(t, user.id),
  };
  return ok(c, data);
});

/** The learner's own booking, or a 404 response. */
function own(c: AppContext): BookingRow | Response {
  const t = c.get('t');
  const user = c.get('user')!;
  const b = bookingState(t).bookings.find((x) => x.id === c.req.param('id') && x.userId === user.id);
  return b ?? notFound(c, 'Booking');
}

bookingRoutes.get('/me/bookings/:id', requireUser, (c: AppContext) => {
  const b = own(c);
  return b instanceof Response ? b : ok(c, presentBooking(c.get('t'), b, Date.now()));
});

bookingRoutes.post('/me/bookings/:id/reschedule', requireUser, async (c: AppContext) => {
  const t = c.get('t');
  const b = own(c);
  if (b instanceof Response) return b;
  const now = Date.now();
  const service = serviceById(t, b.productId);
  if (!service || learnerStatus(b, now) !== 'confirmed') return apiError(c, 409, 'Only booked sessions can be rescheduled.', 'conflict');
  if (!withinPolicy(b, service, now)) return invalid(c, { startsAt: 'It’s too late to reschedule this session.' });
  if (b.rescheduleCount >= MAX_RESCHEDULES) return invalid(c, { startsAt: 'You’ve rescheduled this session the maximum number of times.' });
  const body = await rawBody(c);
  const start = instant(body.starts_at);
  const errors: Record<string, string> = {};
  if (typeof start === 'string') errors.startsAt = start;
  if (body.timezone !== undefined && body.timezone !== null && !isTimeZone(body.timezone)) errors.timezone = 'Choose a valid time zone.';
  if (Object.keys(errors).length || typeof start === 'string') return invalid(c, errors);
  const moved = reserve(bookingState(t), service, start, now, {
    user: c.get('user')!,
    mode: 'confirm',
    timezone: typeof body.timezone === 'string' ? body.timezone : b.timezone,
    existing: b,
  });
  if (!moved) return taken(c);
  moved.rescheduleCount += 1;
  return ok(c, presentBooking(t, moved, now));
});

bookingRoutes.post('/me/bookings/:id/cancel', requireUser, async (c: AppContext) => {
  const t = c.get('t');
  const b = own(c);
  if (b instanceof Response) return b;
  const body = await rawBody(c);
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length > 500) return invalid(c, { reason: 'The reason field must not be greater than 500 characters.' });
  const now = Date.now();
  const status = learnerStatus(b, now);
  if (status === 'held') {
    // An unpaid hold just lapses.
    b.status = 'expired';
    b.slotKey = null;
    return ok(c, presentBooking(t, b, now));
  }
  const service = serviceById(t, b.productId);
  if (status === 'completed' || status === 'no_show' || (status === 'confirmed' && !withinPolicy(b, service, now)))
    return invalid(c, { booking: 'It’s too late to cancel this session.' });
  if (status !== 'confirmed') return apiError(c, 409, 'This session is already cancelled.', 'conflict');
  Object.assign(b, {
    status: 'cancelled',
    slotKey: null,
    cancelReason: reason || null,
    cancelledBy: 'learner',
    cancelledAt: iso(now),
    sequence: b.sequence + 1,
  });
  const s = bookingState(t);
  const pkg = s.packages.find((p) => p.id === b.packageId);
  const order = pkg?.orderId ? t.orders.find((o) => o.id === pkg.orderId) : undefined;
  if (pkg && pkg.sessionsTotal === 1 && order && (order.status === 'paid' || order.status === 'partially_refunded')) {
    // A single paid session cancelled in time is refunded in full (the credit is not returned).
    issueCreditNote(t, order, order.total - (order.refunded ?? 0), iso(now));
    order.status = 'refunded';
    order.refunded = order.total;
    pkg.status = 'refunded';
  } else if (pkg) pkg.sessionsUsed = Math.max(0, pkg.sessionsUsed - 1);
  return ok(c, presentBooking(t, b, now));
});

bookingRoutes.post('/me/bookings/:id/join', requireUser, (c: AppContext) => {
  const b = own(c);
  if (b instanceof Response) return b;
  const now = Date.now();
  const status = learnerStatus(b, now);
  if (status === 'completed') return apiError(c, 409, 'This session has ended.', 'conflict');
  if (status !== 'confirmed') return apiError(c, 409, 'This session isn’t booked.', 'conflict');
  if (!isOnline(b.locationType)) return apiError(c, 409, 'This session isn’t online.', 'conflict');
  if (now < Date.parse(b.startsAt) - 15 * MIN) return apiError(c, 409, 'You can join from 15 minutes before the start.', 'conflict');
  if (b.locationType === 'video')
    return ok(c, {
      kind: 'room',
      roomUrl: `https://coursiva.daily.co/${b.roomName ?? `bk-${b.id}`}`,
      token: `mock-daily-token-${b.id}`,
      expiresAt: b.endsAt,
    });
  if (!b.meeting?.joinUrl) return apiError(c, 409, 'The meeting link isn’t ready yet.', 'conflict');
  return ok(c, { kind: 'link', joinUrl: b.meeting.joinUrl });
});

bookingRoutes.get('/me/bookings/:id/calendar.ics', requireUser, (c: AppContext) => {
  const b = own(c);
  if (b instanceof Response) return b;
  return c.body(bookingIcs(c.get('t'), b, Date.now()), 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `attachment; filename="${b.id}.ics"`,
    'Cache-Control': 'no-store',
  });
});
