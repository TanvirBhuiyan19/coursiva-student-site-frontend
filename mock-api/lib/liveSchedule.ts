/**
 * The mock's live schedule (Laravel: Live\Schedule\LiveSchedule + LiveCalendarFeeds). Each tenant gets a handful of
 * sessions around "now" — live, starting soon (join open), tomorrow, the community event, next week, and two past
 * ones (a published replay, a recording still processing) — plus the per-learner calendar feed token (only its hash
 * is kept, as in Laravel).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { LiveTicketOffer } from '@/features/learning/types';
import type { LiveScheduleItem, LiveSession } from '@/features/live/types';
import type { PublicWebinar } from '@/features/webinars/types';
import { money } from './present';
import type { TenantData, UserRow } from './records';

export interface MockLiveSession {
  id: string;
  title: string;
  startsAt: string;
  durationMin: number;
  provider: LiveScheduleItem['provider'];
  attendees: number;
  startedAt: string | null;
  endedAt: string | null;
  recording: 'published' | 'processing' | null;
  space: { id: string; name: string } | null;
  /** Track F: paid / members-only sessions (minor units), capacity and the public webinar page. */
  access?: 'free' | 'paid' | 'members';
  price?: number;
  seriesPrice?: number | null;
  capacity?: number | null;
  publicSlug?: string | null;
  description?: string;
}

const MIN = 60_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
/** The built-in room session of the room mock (routes/learning.ts → ROOM): live, every learner registered. */
export const ROOM_ID = 'evt_room';

const schedules = new WeakMap<TenantData, MockLiveSession[]>();
const feeds = new WeakMap<TenantData, Map<string, { hash: string; createdAt: string; lastUsedAt: string | null }>>();

export function liveSessionsOf(t: TenantData): MockLiveSession[] {
  let list = schedules.get(t);
  if (!list) {
    list = [
      {
        id: ROOM_ID,
        title: 'Office hours with Maya',
        startsAt: at(-10 * MIN),
        durationMin: 60,
        provider: 'built_in',
        attendees: 12,
        startedAt: at(-10 * MIN),
        endedAt: null,
        recording: null,
        space: null,
      },
      {
        id: 'evt_soon',
        title: 'Funnel teardown: your landing pages',
        startsAt: at(10 * MIN),
        durationMin: 45,
        provider: 'built_in',
        attendees: 18,
        startedAt: null,
        endedAt: null,
        recording: null,
        space: null,
      },
      {
        id: 'evt_tomorrow',
        title: 'Email copy clinic',
        startsAt: at(26 * 60 * MIN),
        durationMin: 90,
        provider: 'zoom',
        attendees: 31,
        startedAt: null,
        endedAt: null,
        recording: null,
        space: null,
        // A free public webinar (`/webinars/email-copy-clinic`).
        publicSlug: 'email-copy-clinic',
        capacity: 100,
        description:
          'Bring an email you are about to send. We rewrite subject lines and openers live, and you leave with a checklist for every launch email.\n\nOpen to everyone — no course needed.',
      },
      {
        id: 'evt_paid',
        title: 'Checkout teardown: live build',
        startsAt: at(3 * 24 * 60 * MIN),
        durationMin: 60,
        provider: 'built_in',
        attendees: 23,
        startedAt: null,
        endedAt: null,
        recording: null,
        space: null,
        // A paid public webinar with a series ticket (`/webinars/checkout-teardown`).
        access: 'paid',
        price: 2900,
        seriesPrice: 7900,
        capacity: 40,
        publicSlug: 'checkout-teardown',
        description: 'We rebuild a real checkout page live and fix what loses sales: pricing, trust, the form and the follow-up.',
      },
      {
        id: 'evt_members',
        title: 'Members’ hot seat',
        startsAt: at(5 * 24 * 60 * MIN),
        durationMin: 45,
        provider: 'built_in',
        attendees: 9,
        startedAt: null,
        endedAt: null,
        recording: null,
        space: null,
        access: 'members',
      },
      {
        id: t.event.id,
        title: t.event.title,
        startsAt: t.event.startsAt,
        durationMin: 60,
        provider: t.event.provider,
        attendees: t.event.attendees,
        startedAt: null,
        endedAt: null,
        recording: null,
        space: { id: 'sp_general', name: 'General' },
      },
      {
        id: 'evt_nextweek',
        title: 'Ads that convert: live build',
        startsAt: at(9 * 24 * 60 * MIN),
        durationMin: 60,
        provider: 'teams',
        attendees: 7,
        startedAt: null,
        endedAt: null,
        recording: null,
        space: null,
      },
      {
        id: 'evt_replay',
        title: 'Pricing workshop',
        startsAt: at(-2 * 24 * 60 * MIN),
        durationMin: 60,
        provider: 'built_in',
        attendees: 44,
        startedAt: at(-2 * 24 * 60 * MIN),
        endedAt: at(-2 * 24 * 60 * MIN + 62 * MIN),
        recording: 'published',
        space: null,
      },
      {
        id: 'evt_processing',
        title: 'Q&A: launching your first course',
        startsAt: at(-20 * 60 * MIN),
        durationMin: 60,
        provider: 'zoom',
        attendees: 22,
        startedAt: at(-20 * 60 * MIN),
        endedAt: at(-19 * 60 * MIN),
        recording: 'processing',
        space: null,
      },
    ].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) as MockLiveSession[];
    schedules.set(t, list);
  }
  return list;
}

export const findLiveSession = (t: TenantData, id: string) => liveSessionsOf(t).find((s) => s.id === id) ?? null;

const isGoing = (t: TenantData, user: UserRow, s: MockLiveSession) =>
  s.id === ROOM_ID || t.rsvps.some((r) => r.userId === user.id && r.eventId === s.id);

// ---------- Tickets (Track F; Laravel Live\Tickets\LiveTickets) ----------

const tickets = new WeakMap<TenantData, Set<string>>();
const ticketSet = (t: TenantData) => {
  let set = tickets.get(t);
  if (!set) tickets.set(t, (set = new Set()));
  return set;
};

/** A bought seat: the ticket, and the learner registered (source `ticket`). */
export function buyTicket(t: TenantData, user: UserRow, sessionId: string) {
  ticketSet(t).add(`${user.id}:${sessionId}`);
  if (!t.rsvps.some((r) => r.userId === user.id && r.eventId === sessionId)) t.rsvps.push({ userId: user.id, eventId: sessionId });
}
export const boughtTicket = (t: TenantData, user: UserRow, sessionId: string) => ticketSet(t).has(`${user.id}:${sessionId}`);

/** Registered learners (the mock's count plus RSVPs), checked against capacity. */
const taken = (t: TenantData, s: MockLiveSession) => s.attendees + t.rsvps.filter((r) => r.eventId === s.id).length;

/** `LiveTicketOffer` (null for free sessions). Members-only: any membership is the included one. */
export function ticketOffer(t: TenantData, user: UserRow | null, s: MockLiveSession): LiveTicketOffer | null {
  const access = s.access ?? 'free';
  if (access === 'free') return null;
  const hasAccess = !!user && (boughtTicket(t, user, s.id) || (access === 'members' && !!user.membershipPlanId));
  return {
    access,
    price: access === 'paid' && s.price ? money(t, s.price) : null,
    seriesPrice: access === 'paid' && s.seriesPrice ? money(t, s.seriesPrice) : null,
    hasAccess,
    soldOut: s.capacity !== null && s.capacity !== undefined && taken(t, s) >= s.capacity,
  };
}

/** Why the learner can't RSVP free (Laravel: 402 `ticket_required` / `members_only`), else null. */
export function needsTicket(t: TenantData, user: UserRow, s: MockLiveSession): 'ticket_required' | 'members_only' | null {
  const offer = ticketOffer(t, user, s);
  if (offer === null || offer.hasAccess) return null;
  return offer.access === 'members' ? 'members_only' : 'ticket_required';
}

/** The `LiveScheduleItem` (Laravel LiveSchedule::present). */
export function presentLiveItem(t: TenantData, user: UserRow, s: MockLiveSession): LiveScheduleItem {
  const going = isGoing(t, user, s);
  const start = Date.parse(s.startsAt);
  const course = t.courses[0];
  return {
    id: s.id,
    title: s.title,
    startsAt: s.startsAt,
    endsAt: new Date(start + s.durationMin * MIN).toISOString(),
    durationMin: s.durationMin,
    joinOpensAt: new Date(start - 15 * MIN).toISOString(),
    status: s.endedAt ? 'ended' : s.startedAt ? 'live' : 'scheduled',
    provider: s.provider,
    attendees: s.attendees + t.rsvps.filter((r) => r.eventId === s.id).length,
    going,
    waitlisted: false,
    joinUrl:
      !going || s.endedAt
        ? null
        : s.provider === 'built_in'
          ? `https://${t.site.primaryHost}/live/${s.id}/room`
          : `https://zoom.us/j/8812345678?pwd=${user.id}`,
    course: s.space || !course ? null : { slug: course.slug, title: course.title },
    space: s.space,
    hasReplay: !!s.endedAt && s.recording === 'published',
    ticket: ticketOffer(t, user, s),
  };
}

/** Track A's LiveCalendar::links: Google and Outlook "add" links with the real length. */
function calendarLinks(t: TenantData, s: MockLiveSession, page = `https://${t.site.primaryHost}/live/${s.id}`) {
  const start = new Date(s.startsAt);
  const end = new Date(start.getTime() + s.durationMin * MIN);
  const ics = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const google = new URLSearchParams({
    action: 'TEMPLATE',
    dates: `${ics(start)}/${ics(end)}`,
    details: `Join: ${page}`,
    location: page,
    text: s.title,
  });
  const outlook = new URLSearchParams({
    body: `Join: ${page}`,
    enddt: end.toISOString(),
    location: page,
    path: '/calendar/action/compose',
    rru: 'addevent',
    startdt: start.toISOString(),
    subject: s.title,
  });
  return {
    google: `https://calendar.google.com/calendar/render?${google}`,
    outlook: `https://outlook.live.com/calendar/0/deeplink/compose?${outlook}`,
  };
}

/** `GET /me/live/{id}` for a schedule session (Laravel show + LiveSchedule::details). */
export function presentLiveSession(t: TenantData, user: UserRow, s: MockLiveSession): LiveSession {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `has_replay` is a schedule-row field only
  const { hasReplay, ...rest } = presentLiveItem(t, user, s);
  const session: LiveSession = {
    ...rest,
    polls: [],
    calendar: calendarLinks(t, s),
    replay: !s.endedAt
      ? null
      : s.recording === 'processing'
        ? { status: 'processing', video: null, recap: null }
        : s.recording === 'published'
          ? {
              status: 'available',
              // The mock has no media: the player shows its poster and notice.
              video: { hlsUrl: null, posterUrl: null, drm: null, captions: [], url: null, embedUrl: null, watermark: null },
              recap: null,
            }
          : { status: 'none', video: null, recap: null },
  };
  return session;
}

export function schedulePage(t: TenantData, user: UserRow, scope: string, limit: number, cursor: string | null) {
  const now = Date.now();
  let rows = liveSessionsOf(t).filter((s) =>
    scope === 'recordings'
      ? !!s.endedAt && s.recording === 'published'
      : !s.endedAt && (!!s.startedAt || Date.parse(s.startsAt) + (s.durationMin + 60) * MIN > now),
  );
  if (scope === 'going') rows = rows.filter((s) => isGoing(t, user, s));
  if (scope === 'recordings') rows = rows.reverse();
  const from = cursor ? rows.findIndex((s) => s.id === cursor) + 1 : 0;
  const page = rows.slice(from, from + limit);
  const more = from + limit < rows.length;
  return {
    sessions: page.map((s) => presentLiveItem(t, user, s)),
    nextCursor: more ? page.at(-1)!.id : null,
    timezone: null,
  };
}

// ---------- Calendar feed ----------

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

function feedsOf(t: TenantData) {
  let m = feeds.get(t);
  if (!m) feeds.set(t, (m = new Map<string, { hash: string; createdAt: string; lastUsedAt: string | null }>()));
  return m;
}

export function feedStatus(t: TenantData, user: UserRow) {
  const f = feedsOf(t).get(user.id);
  return { active: !!f, createdAt: f?.createdAt ?? null, lastUsedAt: f?.lastUsedAt ?? null };
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function issueFeed(t: TenantData, user: UserRow) {
  const token = `lcal_${Array.from(randomBytes(48), (b) => ALNUM[b % ALNUM.length]).join('')}`;
  feedsOf(t).set(user.id, { hash: sha(token), createdAt: new Date().toISOString(), lastUsedAt: null });
  const url = `https://${t.site.primaryHost}/api/v1/live/calendar/${token}.ics`;
  const webcalUrl = url.replace(/^https?:\/\//, 'webcal://');
  return {
    ...feedStatus(t, user),
    url,
    webcalUrl,
    googleUrl: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl)}`,
    outlookUrl: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent(`${t.site.name} live classes`)}`,
  };
}

export const revokeFeed = (t: TenantData, user: UserRow) => void feedsOf(t).delete(user.id);

/** The learner behind a feed token (only a well-formed, current one). */
export function feedUser(t: TenantData, token: string): UserRow | null {
  if (!/^lcal_[A-Za-z0-9]{48}$/.test(token)) return null;
  const hash = sha(token);
  for (const [userId, f] of feedsOf(t)) {
    if (f.hash === hash) {
      f.lastUsedAt = new Date().toISOString();
      return t.users.find((u) => u.id === userId) ?? null;
    }
  }
  return null;
}

const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

/** The learner's feed: their RSVP'd sessions (Laravel LiveCalendar::feed; no folding needed for the mock's titles). */
export function feedIcs(t: TenantData, user: UserRow): string {
  const events = liveSessionsOf(t).filter((s) => s.id !== ROOM_ID && t.rsvps.some((r) => r.userId === user.id && r.eventId === s.id));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Coursiva//Live classes//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`${t.site.name} live classes`)}`,
  ];
  for (const s of events) {
    const page = `https://${t.site.primaryHost}/live/${s.id}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:live-${s.id}@${t.site.primaryHost}`,
      'SEQUENCE:0',
      `DTSTAMP:${stamp(new Date().toISOString())}`,
      `DTSTART:${stamp(s.startsAt)}`,
      `DTEND:${stamp(new Date(Date.parse(s.startsAt) + s.durationMin * MIN).toISOString())}`,
      `SUMMARY:${esc(s.title)}`,
      `DESCRIPTION:${esc(`Join: ${page}`)}`,
      `URL:${page}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR', '');
  return lines.join('\r\n');
}

// ---------- Public webinars (Track F; Laravel Live\Tickets\Webinars) ----------

export const findWebinar = (t: TenantData, slug: string) => liveSessionsOf(t).find((s) => s.publicSlug === slug) ?? null;

/** `PublicWebinar`: only what the page shows (no registrants, no join links). */
export function presentWebinar(t: TenantData, s: MockLiveSession): PublicWebinar {
  const left = s.capacity === null || s.capacity === undefined ? null : Math.max(0, s.capacity - taken(t, s));
  const course = t.courses[0];
  const access = s.access ?? 'free';
  return {
    id: s.id,
    slug: s.publicSlug!,
    title: s.title,
    description: s.description ?? '',
    startsAt: s.startsAt,
    durationMin: s.durationMin,
    status: s.endedAt ? 'ended' : s.startedAt ? 'live' : 'scheduled',
    timeZone: 'America/New_York',
    course: course ? { title: course.title, slug: course.slug } : null,
    access,
    price: access === 'paid' && s.price ? money(t, s.price) : null,
    seatsLeft: left,
    soldOut: left === 0,
    registrationOpen: !s.endedAt,
    form: { token: `wbt.${s.id}.${Date.now()}`, turnstileSiteKey: null, minFillSeconds: 3 },
    calendar: calendarLinks(t, s, `https://${t.site.primaryHost}/webinars/${s.publicSlug}`),
  };
}

/** Webinar registrations by `session:email` → the personal join token (in memory, like the rest of the mock). */
const webinarRegs = new WeakMap<TenantData, Map<string, { token: string; status: 'registered' | 'waitlisted' }>>();

export function registerWebinar(t: TenantData, s: MockLiveSession, email: string) {
  let m = webinarRegs.get(t);
  if (!m) webinarRegs.set(t, (m = new Map<string, { token: string; status: 'registered' | 'waitlisted' }>()));
  const key = `${s.id}:${email.toLowerCase()}`;
  let reg = m.get(key);
  if (!reg) {
    const left = s.capacity === null || s.capacity === undefined ? 1 : s.capacity - taken(t, s);
    reg = {
      token: `wjt_${Array.from(randomBytes(20), (b) => ALNUM[b % ALNUM.length]).join('')}`,
      status: left > 0 ? 'registered' : 'waitlisted',
    };
    m.set(key, reg);
  }
  return reg;
}

/** The registration behind a join token: its session and email. */
export function webinarByToken(t: TenantData, token: string): { sessionId: string; email: string } | null {
  for (const [key, reg] of webinarRegs.get(t) ?? []) {
    if (reg.token === token) {
      const at = key.indexOf(':');
      return { sessionId: key.slice(0, at), email: key.slice(at + 1) };
    }
  }
  return null;
}
