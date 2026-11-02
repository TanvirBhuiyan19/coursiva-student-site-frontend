/**
 * Service products and bookings seed (built per reset, relative to "now" so the demo always has upcoming times).
 * Amplify sells a single strategy call and a 5-session coaching package, both hosted by Maya in New York; Jordan has
 * the package with 3 sessions left, one upcoming session and one past.
 */
import { addDays, localDate, weekdayOf, zonedTimeToUtc } from '@/lib/timezone';
import type { BookingState, HostRow } from '../lib/bookings';

const NY = 'America/New_York';
const WORKDAY: [string, string][] = [
  ['09:00', '12:00'],
  ['13:00', '17:00'],
];
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

export function bookingSeed(tenant: string, now: number): BookingState {
  if (tenant !== 'amplify') return { hosts: [], services: [], packages: [], bookings: [] };
  const maya: HostRow = {
    id: 'bh_maya',
    userId: 'usr_maya',
    name: 'Maya Reyes',
    timezone: NY,
    weekly: { mon: WORKDAY, tue: WORKDAY, wed: WORKDAY, thu: WORKDAY, fri: WORKDAY, sat: [], sun: [['09:00', '12:00']] },
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    minNoticeMin: 240,
    maxDaysAhead: 60,
    dailyCap: null,
    active: true,
    overrides: [],
    timeOff: [],
  };
  // Jordan's next coaching session: 10:00 New York on the first weekday at least 6 days out.
  let day = localDate(now + 6 * 86_400_000, NY);
  while (['sat', 'sun'].includes(weekdayOf(day))) day = addDays(day, 1);
  const next = zonedTimeToUtc(day, '10:00', NY);
  const past = zonedTimeToUtc(addDays(localDate(now, NY), -9), '11:00', NY);
  return {
    hosts: [maya],
    services: [
      {
        id: 'prd_strategy_call',
        slug: 'strategy-call',
        title: 'Strategy call',
        description: 'A 60-minute call with Maya to plan your next launch: offer, funnel and the numbers that matter.',
        price: 15000,
        status: 'published',
        sessionMinutes: 60,
        sessions: 1,
        bookingWindowDays: 30,
        hostIds: ['bh_maya'],
        location: { type: 'video', detail: '' },
        intakeQuestions: [
          { key: 'goal', label: 'What would you like to get out of the call?', type: 'textarea', required: true },
          { key: 'website', label: 'Your website', type: 'text', required: false },
        ],
        cancelNoticeHours: 24,
      },
      {
        id: 'prd_coaching_pack',
        slug: 'launch-coaching',
        title: 'Launch coaching',
        description: 'Five 45-minute coaching sessions over Zoom, booked whenever suits you.',
        price: 60000,
        status: 'published',
        sessionMinutes: 45,
        sessions: 5,
        bookingWindowDays: 60,
        hostIds: ['bh_maya'],
        location: { type: 'zoom', detail: '' },
        intakeQuestions: [],
        cancelNoticeHours: 24,
      },
    ],
    packages: [
      {
        id: 'bp_demo',
        userId: 'usr_jordan',
        productId: 'prd_coaching_pack',
        orderId: null,
        sessionsTotal: 5,
        sessionsUsed: 2,
        status: 'active',
        createdAt: iso(now - 20 * 86_400_000),
      },
    ],
    bookings: [
      {
        id: 'bk_demo_next',
        productId: 'prd_coaching_pack',
        productTitle: 'Launch coaching',
        hostId: 'bh_maya',
        userId: 'usr_jordan',
        packageId: 'bp_demo',
        status: 'confirmed',
        startsAt: iso(next),
        endsAt: iso(next + 45 * 60_000),
        timezone: 'America/Los_Angeles',
        holdExpiresAt: null,
        slotKey: `bh_maya|${Math.floor(next / 1000)}`,
        locationType: 'zoom',
        locationDetail: null,
        phone: null,
        answers: [],
        meeting: { joinUrl: 'https://zoom.example.com/j/123456789' },
        roomName: null,
        sequence: 0,
        rescheduleCount: 0,
        cancelReason: null,
        cancelledBy: null,
        cancelledAt: null,
        createdAt: iso(now - 3 * 86_400_000),
      },
      {
        id: 'bk_demo_past',
        productId: 'prd_coaching_pack',
        productTitle: 'Launch coaching',
        hostId: 'bh_maya',
        userId: 'usr_jordan',
        packageId: 'bp_demo',
        status: 'confirmed',
        startsAt: iso(past),
        endsAt: iso(past + 45 * 60_000),
        timezone: 'America/Los_Angeles',
        holdExpiresAt: null,
        slotKey: `bh_maya|${Math.floor(past / 1000)}`,
        locationType: 'zoom',
        locationDetail: null,
        phone: null,
        answers: [],
        meeting: { joinUrl: 'https://zoom.example.com/j/987654321' },
        roomName: null,
        sequence: 0,
        rescheduleCount: 0,
        cancelReason: null,
        cancelledBy: null,
        cancelledAt: null,
        createdAt: iso(now - 19 * 86_400_000),
      },
    ],
  };
}
