/**
 * Contract tests for service products and 1:1 bookings (docs/api/commerce.md → Service products, docs/api/account.md
 * → Bookings): availability (DST-correct, grouped in the learner's zone), holds, credits, double-booking, checkout
 * fulfilment and the cancel/reschedule policy. Run against the mock, they describe what Laravel and Go return.
 */
import { app } from './app';
import { reset } from './lib/db';

type Json = Record<string, any>;
const list = (v: unknown) => v as Json[];

function browser(tenant = 'amplify') {
  const jar = new Map<string, string>();
  const send = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'X-Tenant': tenant, Accept: 'application/json' };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && jar.has('XSRF-TOKEN')) headers['X-XSRF-TOKEN'] = decodeURIComponent(jar.get('XSRF-TOKEN')!);
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair!.split('=');
      if (/Max-Age=0/i.test(c) || v === '') jar.delete(k!);
      else jar.set(k!, v!);
    }
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, json: text.startsWith('{') ? (JSON.parse(text) as Json) : null };
  };
  return {
    get: (p: string) => send('GET', p),
    post: async (p: string, b: unknown = {}) => {
      if (!jar.has('XSRF-TOKEN')) await send('GET', '/sanctum/csrf-cookie');
      return send('POST', p, b);
    },
    async signIn(email = 'jordan.tate@gmail.com') {
      await send('GET', '/sanctum/csrf-cookie');
      return send('POST', '/api/v1/auth/login', { email, password: 'password', remember: false });
    },
  };
}

const at = (iso: string) => vi.setSystemTime(new Date(iso));
const availability = (q: string) => browser().get(`/api/v1/products/strategy-call/availability?${q}`);
const GOAL = { goal: 'Plan my launch' };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // A Tuesday, before London (Oct 25) and New York (Nov 1) leave summer time.
  at('2026-10-20T12:00:00Z');
  reset();
});
afterEach(() => vi.useRealTimers());

describe('service product page', () => {
  it('describes how a session works; only published services with an active host are sold', async () => {
    const res = await browser().get('/api/v1/products/strategy-call');
    expect(res.status).toBe(200);
    expect(res.json!.data).toMatchObject({
      slug: 'strategy-call',
      kind: 'service',
      price: { amount: 15000, currency: 'USD' },
      file: null,
      delivery: null,
      courses: [],
      service: {
        session_minutes: 60,
        sessions: 1,
        location_type: 'video',
        cancel_notice_hours: 24,
        intake_questions: [
          { key: 'goal', label: 'What would you like to get out of the call?', type: 'textarea', required: true },
          { key: 'website', label: 'Your website', type: 'text', required: false },
        ],
      },
    });
    expect((await browser().get('/api/v1/products/launch-kit')).json!.data.service).toBeNull();
  });
});

describe('availability', () => {
  it('is DST-correct: a 09:00 New York Sunday reads 13:00 in London on Oct 25 and 14:00 on Nov 1', async () => {
    const res = await availability('from=2026-10-25&days=8&timezone=Europe/London');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const data = res.json!.data;
    expect(data.timezone).toBe('Europe/London');
    expect(data.slot_minutes).toBe(60);
    const sunday = (date: string) => list(data.days).find((d: Json) => d.date === date);
    // 60-minute sessions start every 30 minutes until the last one that ends by 12:00.
    expect(list(sunday('2026-10-25')!.slots).map((s: Json) => s.starts_at)).toEqual([
      '2026-10-25T13:00:00Z',
      '2026-10-25T13:30:00Z',
      '2026-10-25T14:00:00Z',
      '2026-10-25T14:30:00Z',
      '2026-10-25T15:00:00Z',
    ]);
    expect(sunday('2026-10-25')!.slots[0].ends_at).toBe('2026-10-25T14:00:00Z');
    expect(sunday('2026-11-01')!.slots[0].starts_at).toBe('2026-11-01T14:00:00Z');
    // Saturdays have no hours: only days with slots are listed, in order.
    expect(list(data.days).some((d: Json) => d.date === '2026-10-31')).toBe(false);
    expect(list(data.days).map((d) => d.date)).toEqual([...list(data.days).map((d) => d.date)].sort());
  });

  it('groups by the learner’s local date and refuses unknown zones and bad windows', async () => {
    const tokyo = (await availability('from=2026-10-25&days=2&timezone=Asia/Tokyo')).json!.data;
    // Sunday 09:00–10:30 New York starts are Sunday evening in Tokyo; 11:00 New York is already Monday there.
    expect(tokyo.days[0].date).toBe('2026-10-25');
    expect(list(tokyo.days[0].slots).map((s: Json) => s.starts_at)).toEqual([
      '2026-10-25T13:00:00Z',
      '2026-10-25T13:30:00Z',
      '2026-10-25T14:00:00Z',
      '2026-10-25T14:30:00Z',
    ]);
    expect(tokyo.days[1]).toMatchObject({ date: '2026-10-26' });
    expect(tokyo.days[1].slots[0].starts_at).toBe('2026-10-25T15:00:00Z');
    const bad = await availability('from=2026-10-25&timezone=Mars/Olympus');
    expect(bad.status).toBe(422);
    expect(bad.json!.errors).toEqual({ timezone: ['Choose a valid time zone.'] });
    expect((await availability('days=40&timezone=UTC')).json!.errors.days[0]).toMatch(/between 1 and 31/);
    expect((await browser().get('/api/v1/products/nope/availability?timezone=UTC')).status).toBe(404);
  });

  it('keeps the minimum notice and the booking window', async () => {
    // It is 08:00 in New York: with 4 hours' notice nothing before 12:00 local, and the afternoon opens at 13:00 (17:00Z).
    const today = (await availability('from=2026-10-20&days=1&timezone=America/New_York')).json!.data.days[0];
    expect(today.slots[0].starts_at).toBe('2026-10-20T17:00:00Z');
    // 30-day window: nothing on Nov 25 (36 days out).
    expect((await availability('from=2026-11-25&days=3&timezone=UTC')).json!.data.days).toEqual([]);
  });
});

describe('booking a time', () => {
  it('validates the intake answers, holds the slot for checkout and refuses it to everyone else', async () => {
    const jordan = browser();
    expect(
      (await jordan.post('/api/v1/products/strategy-call/bookings', { starts_at: '2026-10-25T13:00:00Z', timezone: 'Europe/London' }))
        .status,
    ).toBe(401);
    await jordan.signIn();
    const missing = await jordan.post('/api/v1/products/strategy-call/bookings', {
      starts_at: '2026-10-25T13:00:00Z',
      timezone: 'Europe/London',
    });
    expect(missing.status).toBe(422);
    expect(missing.json!.errors).toEqual({ 'answers.goal': ['Answer “What would you like to get out of the call?”.'] });

    const held = await jordan.post('/api/v1/products/strategy-call/bookings', {
      starts_at: '2026-10-25T13:00:00Z',
      timezone: 'Europe/London',
      answers: GOAL,
    });
    expect(held.status).toBe(201);
    expect(held.json!.data).toMatchObject({
      next: 'checkout',
      checkout_url_path: '/checkout?product=strategy-call',
      booking: {
        status: 'held',
        product: { slug: 'strategy-call', title: 'Strategy call' },
        starts_at: '2026-10-25T13:00:00Z',
        ends_at: '2026-10-25T14:00:00Z',
        timezone: 'Europe/London',
        host: { name: 'Maya Reyes' },
        location: { type: 'video', detail: null },
        hold_expires_at: '2026-10-20T12:15:00Z',
        can_cancel: true,
        can_reschedule: false,
        answers: [{ key: 'goal', label: 'What would you like to get out of the call?', value: 'Plan my launch' }],
      },
    });
    const sunday = (await availability('from=2026-10-25&days=1&timezone=Europe/London')).json!.data.days[0];
    // 13:30 would overlap the held hour.
    expect(sunday.slots[0].starts_at).toBe('2026-10-25T14:00:00Z');

    const priya = browser();
    await priya.signIn('priya.nair@example.com');
    const clash = await priya.post('/api/v1/products/strategy-call/bookings', {
      starts_at: '2026-10-25T13:00:00Z',
      timezone: 'Europe/London',
      answers: GOAL,
    });
    expect(clash.status).toBe(409);
    expect(clash.json!.message).toBe('That time was just taken. Pick another time.');

    // The hold lapses after 15 minutes: the time is open again and the hold leaves the learner's list.
    at('2026-10-20T12:16:00Z');
    expect((await availability('from=2026-10-25&days=1&timezone=Europe/London')).json!.data.days[0].slots[0].starts_at).toBe(
      '2026-10-25T13:00:00Z',
    );
    expect(list((await jordan.get('/api/v1/me/bookings')).json!.data.upcoming).map((b: Json) => b.status)).toEqual(['confirmed']);
    expect(
      (await priya.post('/api/v1/products/strategy-call/bookings', { starts_at: '2026-10-25T13:00:00Z', timezone: 'UTC', answers: GOAL }))
        .status,
    ).toBe(201);
  });

  it('a new hold replaces the learner’s previous one; times off the grid are refused', async () => {
    const b = browser();
    await b.signIn();
    const book = (starts_at: string) => b.post('/api/v1/products/strategy-call/bookings', { starts_at, timezone: 'UTC', answers: GOAL });
    expect((await book('2026-10-25T13:00:00Z')).status).toBe(201);
    expect((await book('2026-10-25T14:00:00Z')).status).toBe(201);
    const upcoming = list((await b.get('/api/v1/me/bookings')).json!.data.upcoming).filter((x: Json) => x.status === 'held');
    expect(upcoming.map((x: Json) => x.starts_at)).toEqual(['2026-10-25T14:00:00Z']);
    expect((await book('2026-10-25T13:10:00Z')).status).toBe(409);
    expect((await book('2026-10-31T13:00:00Z')).status).toBe(409);
  });

  it('paying for the held time confirms it; a gift is refused', async () => {
    const b = browser();
    await b.signIn();
    await b.post('/api/v1/products/strategy-call/bookings', {
      starts_at: '2026-10-25T13:00:00Z',
      timezone: 'Europe/London',
      answers: GOAL,
    });
    const body = {
      target: { kind: 'product', product_slug: 'strategy-call' },
      plan: 'full',
      seats: 1,
      country: 'United States',
      name: 'Jordan Tate',
      email: 'jordan.tate@gmail.com',
      payment_method: 'card',
      payment_token: 'tok_visa',
      accept_terms: true,
    };
    const quote = await b.post('/api/v1/checkout/quote', body);
    expect(quote.json!.data.lines[0]).toMatchObject({ title: 'Strategy call', price: { amount: 15000 } });
    const gift = await b.post('/api/v1/checkout', { ...body, gift: { recipient_email: 'friend@example.com', message: '' } });
    expect(gift.json!.errors.target).toEqual(['Sessions can’t be sent as a gift.']);
    const order = await b.post('/api/v1/checkout', body);
    expect(order.status).toBe(201);
    expect(order.json!.data.items[0]).toMatchObject({ kind: 'product', meta: '1:1 session · 60 min' });
    const mine = (await b.get('/api/v1/me/bookings')).json!.data;
    expect(mine.upcoming[0]).toMatchObject({ status: 'confirmed', starts_at: '2026-10-25T13:00:00Z', can_reschedule: true });
    // The single session is used: no credit left.
    expect(list(mine.credits).map((c: Json) => c.product_slug)).toEqual(['launch-coaching']);
  });

  it('a learner with credits books at once and spends one', async () => {
    const b = browser();
    await b.signIn();
    expect((await b.get('/api/v1/me/bookings')).json!.data.credits).toEqual([
      { product_slug: 'launch-coaching', product_title: 'Launch coaching', remaining: 3, total: 5, package_id: 'bp_demo' },
    ]);
    const res = await b.post('/api/v1/products/launch-coaching/bookings', { starts_at: '2026-10-25T13:00:00Z', timezone: 'Europe/London' });
    expect(res.status).toBe(201);
    expect(res.json!.data).toMatchObject({ next: 'confirmed', booking: { status: 'confirmed', ends_at: '2026-10-25T13:45:00Z' } });
    expect((await b.get('/api/v1/me/bookings')).json!.data.credits[0].remaining).toBe(2);
  });
});

describe('the learner’s sessions', () => {
  const NEXT = '/api/v1/me/bookings/bk_demo_next';

  it('lists upcoming and past sessions; other learners get a 404', async () => {
    const b = browser();
    await b.signIn();
    const mine = (await b.get('/api/v1/me/bookings')).json!.data;
    expect(list(mine.upcoming).map((x: Json) => x.id)).toEqual(['bk_demo_next']);
    expect(list(mine.past).map((x: Json) => [x.id, x.status])).toEqual([['bk_demo_past', 'completed']]);
    expect(mine.upcoming[0]).toMatchObject({
      location: { type: 'zoom', detail: null },
      join_available: false,
      can_cancel: true,
      can_reschedule: true,
      cancel_notice_hours: 24,
    });
    const priya = browser();
    await priya.signIn('priya.nair@example.com');
    expect((await priya.get(NEXT)).status).toBe(404);
  });

  it('reschedules and cancels within the policy, returning the credit', async () => {
    const b = browser();
    await b.signIn();
    const moved = await b.post(`${NEXT}/reschedule`, { starts_at: '2026-10-25T13:00:00Z', timezone: 'Europe/London' });
    expect(moved.status).toBe(200);
    expect(moved.json!.data).toMatchObject({ starts_at: '2026-10-25T13:00:00Z', timezone: 'Europe/London', status: 'confirmed' });
    const cancelled = await b.post(`${NEXT}/cancel`, { reason: 'Travelling' });
    expect(cancelled.json!.data).toMatchObject({ status: 'cancelled', cancel_reason: 'Travelling', can_cancel: false });
    expect((await b.get('/api/v1/me/bookings')).json!.data.credits[0].remaining).toBe(4);
    // The time is free again.
    expect((await availability('from=2026-10-25&days=1&timezone=UTC')).json!.data.days[0].slots[0].starts_at).toBe('2026-10-25T13:00:00Z');
  });

  it('is too late to change inside the notice window; joining opens 15 minutes before the start', async () => {
    const b = browser();
    await b.signIn();
    const start = Date.parse((await b.get(NEXT)).json!.data.starts_at);
    vi.setSystemTime(start - 2 * 3_600_000);
    const s = (await b.get(NEXT)).json!.data;
    expect([s.can_cancel, s.can_reschedule]).toEqual([false, false]);
    expect((await b.post(`${NEXT}/cancel`)).json!.errors).toEqual({ booking: ['It’s too late to cancel this session.'] });
    expect((await b.post(`${NEXT}/reschedule`, { starts_at: '2026-11-02T14:00:00Z' })).json!.errors).toEqual({
      starts_at: ['It’s too late to reschedule this session.'],
    });
    const early = await b.post(`${NEXT}/join`);
    expect([early.status, early.json!.message]).toEqual([409, 'You can join from 15 minutes before the start.']);
    vi.setSystemTime(start - 10 * 60_000);
    expect((await b.get(NEXT)).json!.data.join_available).toBe(true);
    expect((await b.post(`${NEXT}/join`)).json!.data).toEqual({ kind: 'link', join_url: 'https://zoom.example.com/j/123456789' });
  });

  it('allows three reschedules', async () => {
    const b = browser();
    await b.signIn();
    for (const t of ['2026-10-25T13:00:00Z', '2026-10-25T14:00:00Z', '2026-10-25T15:00:00Z'])
      expect((await b.post(`${NEXT}/reschedule`, { starts_at: t })).status).toBe(200);
    const res = await b.post(`${NEXT}/reschedule`, { starts_at: '2026-11-01T14:00:00Z' });
    expect(res.json!.errors).toEqual({ starts_at: ['You’ve rescheduled this session the maximum number of times.'] });
    expect((await b.get(NEXT)).json!.data.can_reschedule).toBe(false);
  });

  it('serves the calendar file with the join page as LOCATION', async () => {
    const b = browser();
    await b.signIn();
    const res = await b.get(`${NEXT}/calendar.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/calendar/);
    expect(res.text).toContain('\r\nUID:bk_demo_next@');
    expect(res.text).toContain('SEQUENCE:0');
    expect(res.text).toMatch(/LOCATION:https:\/\/[^\r]+\/account\/bookings\/bk_demo_next\r\n/);
    expect(res.text).toContain('STATUS:CONFIRMED');
    expect(res.text.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });
});
