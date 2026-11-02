/**
 * Contract tests for paid live sessions and public webinars (Track F; docs/api/community.md → Paid sessions and
 * webinars): what Laravel's LiveTickets / Webinars answer, as the site relies on it.
 */
import { app } from './app';
import { reset } from './lib/db';

/** A cookie-jar client on one tenant (as in app.test.ts). */
function browser(tenant: string) {
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
    return { status: res.status, json: text ? (JSON.parse(text) as Record<string, any>) : null };
  };
  return {
    get: (p: string) => send('GET', p),
    post: (p: string, b: unknown = {}) => send('POST', p, b),
    put: (p: string, b: unknown = {}) => send('PUT', p, b),
    del: (p: string) => send('DELETE', p),
    async signIn(email = 'jordan.tate@gmail.com', password = 'password') {
      await send('GET', '/sanctum/csrf-cookie');
      return send('POST', '/api/v1/auth/login', { email, password, remember: false });
    },
  };
}

beforeEach(() => reset());

describe('public webinars', () => {
  it('shows only what the page needs, and registers visitors with bot protection', async () => {
    const guest = browser('amplify');
    await guest.get('/sanctum/csrf-cookie');
    const page = await guest.get('/api/v1/webinars/email-copy-clinic');
    expect(page.status).toBe(200);
    const w = page.json!.data;
    expect(w).toMatchObject({
      id: 'evt_tomorrow',
      slug: 'email-copy-clinic',
      access: 'free',
      price: null,
      registration_open: true,
      seats_left: 69,
    });
    expect(w.form).toMatchObject({ turnstile_site_key: null, min_fill_seconds: 3 });
    expect(JSON.stringify(w)).not.toMatch(/wjt_|join_token|attendees/);
    expect((await guest.get('/api/v1/webinars/nope')).status).toBe(404);

    const body = { name: 'Vee Visitor', email: 'vee@example.com', token: w.form.token, website: '' };
    expect(
      (await guest.post('/api/v1/webinars/email-copy-clinic/registrations', { ...body, email: 'nope' })).json!.errors.email,
    ).toBeDefined();
    expect(
      (await guest.post('/api/v1/webinars/email-copy-clinic/registrations', { ...body, token: 'old' })).json!.errors.token,
    ).toBeDefined();
    // The honeypot is answered like a success.
    expect((await guest.post('/api/v1/webinars/email-copy-clinic/registrations', { ...body, website: 'x' })).json!.data).toMatchObject({
      next: 'check_email',
    });
    const done = await guest.post('/api/v1/webinars/email-copy-clinic/registrations', body);
    expect(done.json!.data).toEqual({ next: 'check_email', status: 'registered' });
  });

  it('sends paid visitors to checkout and members-only ones to the membership page', async () => {
    const guest = browser('amplify');
    await guest.get('/sanctum/csrf-cookie');
    const w = (await guest.get('/api/v1/webinars/checkout-teardown')).json!.data;
    expect(w).toMatchObject({ access: 'paid', price: { amount: 2900 } });
    const r = await guest.post('/api/v1/webinars/checkout-teardown/registrations', {
      name: 'Pat',
      email: 'pat@example.com',
      token: w.form.token,
      website: '',
    });
    expect(r.json!.data).toMatchObject({ next: 'checkout', checkout_url_path: '/checkout?live=evt_paid' });
  });

  it('signs a guest in with the join link, and refuses other people’s links', async () => {
    const guest = browser('amplify');
    await guest.get('/sanctum/csrf-cookie');
    expect((await guest.post('/api/v1/webinars/join', { t: 'wjt_unknown' })).status).toBe(410);
    expect((await guest.post('/api/v1/webinars/join', { t: 'wjt_demo_guest' })).json!.data).toEqual({
      session_id: 'evt_tomorrow',
      signed_in: true,
    });
    expect((await guest.get('/api/v1/me')).status).toBe(200);

    // The owner continues; another signed-in learner is refused.
    expect((await guest.post('/api/v1/webinars/join', { t: 'wjt_demo_guest' })).json!.data).toEqual({
      session_id: 'evt_tomorrow',
      signed_in: false,
    });
    const priya = browser('amplify');
    await priya.signIn('priya.nair@example.com');
    expect((await priya.post('/api/v1/webinars/join', { t: 'wjt_demo_guest' })).json).toMatchObject({ reason: 'join_link_not_yours' });
    // A registration's link of an account with a password: sign in first (with the session to return to).
    const w = (await priya.get('/api/v1/webinars/email-copy-clinic')).json!.data;
    await browser('amplify').post('/api/v1/webinars/email-copy-clinic/registrations', {
      name: 'Kim',
      email: 'kim@example.com',
      token: w.form.token,
      website: '',
    });
  });
});

describe('paid live sessions', () => {
  it('needs a ticket to RSVP, sells it through checkout at the server price, and keeps the seat', async () => {
    const b = browser('amplify');
    await b.signIn();
    const s = (await b.get('/api/v1/me/live/evt_paid')).json!.data;
    expect(s.ticket).toEqual({
      access: 'paid',
      price: { amount: 2900, currency: 'USD' },
      series_price: { amount: 7900, currency: 'USD' },
      has_access: false,
      sold_out: false,
    });
    const rsvp = await b.put('/api/v1/community/events/evt_paid/rsvp');
    expect(rsvp.status).toBe(402);
    expect(rsvp.json).toMatchObject({ code: 'payment_required', reason: 'ticket_required' });

    const quote = await b.post('/api/v1/checkout/quote', { target: { kind: 'live', live_session_id: 'evt_paid' }, amount: 1 });
    expect(quote.json!.data.subtotal.amount).toBe(2900);
    const series = await b.post('/api/v1/checkout/quote', { target: { kind: 'live', live_session_id: 'evt_paid', series: true } });
    expect(series.json!.data.subtotal.amount).toBe(7900);
    const body = {
      target: { kind: 'live', live_session_id: 'evt_paid' },
      plan: 'full',
      seats: 1,
      country: 'United States',
      name: 'Jordan Tate',
      email: 'jordan.tate@gmail.com',
      payment_method: 'card',
      payment_token: 'tok_visa',
      accept_terms: true,
    };
    expect((await b.post('/api/v1/checkout', { ...body, gift: { recipient_email: 'x@example.com' } })).json!.errors.target).toBeDefined();
    const order = await b.post('/api/v1/checkout', body);
    expect(order.status).toBe(201);
    expect(order.json!.data.items[0]).toMatchObject({ kind: 'live', meta: 'Live class ticket' });
    const after = (await b.get('/api/v1/me/live/evt_paid')).json!.data;
    expect(after).toMatchObject({ going: true, ticket: { has_access: true } });
    expect((await b.del('/api/v1/community/events/evt_paid/rsvp')).json).toMatchObject({ reason: 'ticket_bought' });
    expect((await b.post('/api/v1/checkout', body)).json!.errors.target[0]).toMatch(/already have a seat/);

    const members = await b.put('/api/v1/community/events/evt_members/rsvp');
    expect(members.status).toBe(402);
    expect(members.json!.reason).toBe('members_only');
  });
});
