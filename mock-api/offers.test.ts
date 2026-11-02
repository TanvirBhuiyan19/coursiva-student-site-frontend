/**
 * Contract tests for checkout offers (docs/api/commerce.md → Offers, Post-purchase offers): the API prices sales, seat
 * tiers, trials, cross-sells and the bump, and runs the thank-you page's one-click upsell / downsell. Figures and
 * messages follow Laravel's CheckoutOffersTest; the seed's offers are all on Brand Storytelling Lab ($179).
 */
import { app } from './app';
import { allTenants, reset } from './lib/db';

type Json = Record<string, any>;

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
    return { status: res.status, json: text ? (JSON.parse(text) as Json) : null };
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
    /** A new learner: owns nothing, so Brand Storytelling Lab can be bought. */
    async signUp(email = 'lena@example.com') {
      await send('GET', '/sanctum/csrf-cookie');
      return send('POST', '/api/v1/auth/register', { name: 'Lena Learner', email, password: 'password-123' });
    },
  };
}

const amplify = () => allTenants().find((x) => x.site.slug === 'amplify')!;
const brand = { kind: 'course', course_slug: 'brand-storytelling-lab' };
const checkoutBody = (extra: object = {}) => ({
  target: brand,
  plan: 'full',
  seats: 1,
  country: 'United States',
  name: 'Lena Learner',
  email: 'lena@example.com',
  payment_method: 'card',
  payment_token: 'tok_visa',
  accept_terms: true,
  ...extra,
});

beforeEach(() => reset());
afterEach(() => vi.useRealTimers());

describe('checkout offers (quote)', () => {
  it('prices a countdown sale with its list price and savings, and keeps the card for the upsell that follows', async () => {
    const b = browser();
    await b.signUp();
    const q = (await b.post('/api/v1/checkout/quote', { target: brand })).json!.data;
    expect(q.lines[0].price.amount).toBe(15215);
    expect(q.lines[0].compare_at.amount).toBe(17900);
    expect(q.savings.amount).toBe(2685);
    expect(q.total.amount).toBe(15215);
    expect(q.price_offer).toMatchObject({ kind: 'countdown', discount_percent: 15, applied: true, message: null, trial_days: null });
    expect(Date.parse(q.price_offer.ends_at)).toBeGreaterThan(Date.now());
    expect(q.quantity_tiers).toEqual([
      { min_seats: 3, discount_percent: 10 },
      { min_seats: 5, discount_percent: 25 },
    ]);
    expect(q.cross_sell).toMatchObject({ headline: 'Frequently bought together', discount_percent: 30, selected: false });
    expect(q.cross_sell.items[0]).toMatchObject({
      course_slug: 'pricing-with-confidence',
      price: { amount: 6930 },
      compare_at: { amount: 9900 },
    });
    expect(q).toMatchObject({ post_purchase: true, save_card: true });
    // Other courses carry no offers: list prices, nothing kept.
    const other = (await b.post('/api/v1/checkout/quote', { target: { kind: 'course', course_slug: 'podcast-launchpad' } })).json!.data;
    expect(other).toMatchObject({ price_offer: null, cross_sell: null, quantity_tiers: [], post_purchase: false, save_card: false });
    expect(other.lines[0].compare_at).toBeNull();
    expect(other.savings.amount).toBe(0);
  });

  it('gives the better of a sale and a code that doesn’t stack; a stacking code adds on', async () => {
    const b = browser();
    await b.signUp();
    const quote = async (code: string) => (await b.post('/api/v1/checkout/quote', { target: brand, coupon_code: code })).json!.data;
    const weak = await quote('SAVE10');
    expect(weak.coupon).toEqual({
      code: 'SAVE10',
      valid: false,
      message: 'This code can’t be combined with the sale price — you’re already getting the better deal.',
    });
    expect(weak.total.amount).toBe(15215);
    const strong = await quote('LAUNCH20');
    expect(strong.coupon.valid).toBe(true);
    expect(strong.price_offer).toMatchObject({ applied: false, message: 'Your code saves more, so it replaces the sale price.' });
    expect(strong.lines[0].compare_at).toBeNull();
    expect(strong.total.amount).toBe(14300);
    expect((await quote('STACK5')).total.amount).toBe(14415);
  });

  it('applies the seat tier when it saves more, and stops the sale at its end', async () => {
    const b = browser();
    await b.signUp();
    const five = (await b.post('/api/v1/checkout/quote', { target: brand, seats: 5 })).json!.data;
    expect(five.price_offer).toMatchObject({ kind: 'quantity', discount_percent: 25 });
    expect(five.lines[0]).toMatchObject({ price: { amount: 13425 }, quantity: 5, compare_at: { amount: 17900 } });
    expect(five.total.amount).toBe(67125);
    // Three seats reach 10%: the 15% sale still wins. No cross-sell on a team purchase.
    const three = (await b.post('/api/v1/checkout/quote', { target: brand, seats: 3 })).json!.data;
    expect(three.price_offer.kind).toBe('countdown');
    expect(three.cross_sell).toBeNull();

    amplify().offers!.find((o) => o.kind === 'countdown')!.endsAt = new Date(Date.now() - 1000).toISOString();
    expect((await b.post('/api/v1/checkout/quote', { target: brand })).json!.data).toMatchObject({
      price_offer: null,
      total: { amount: 17900 },
    });
    expect((await b.post('/api/v1/checkout', checkoutBody())).json!.data.total.amount).toBe(17900);
  });

  it('adds frequently-bought-together courses at the offer price without the coupon', async () => {
    const b = browser();
    await b.signUp();
    const q = (await b.post('/api/v1/checkout/quote', { target: brand, cross_sell: true, coupon_code: 'STACK5' })).json!.data;
    expect(q.lines).toHaveLength(2);
    expect(q.cross_sell.selected).toBe(true);
    // 5% (rounded to whole dollars in the mock) off the course only: 15,215 − 800 + 6,930.
    expect(q.total.amount).toBe(21345);
    expect(q.savings.amount).toBe(2685 + 2970);
    const order = await b.post('/api/v1/checkout', checkoutBody({ cross_sell: true }));
    expect(order.status).toBe(201);
    expect((order.json!.data.items as Json[]).map((i) => i.title)).toEqual(['Brand Storytelling Lab', 'Pricing with Confidence']);
    const mine = (await b.get('/api/v1/me/enrollments')).json!.data as Json[];
    expect(mine.map((e) => e.course_slug)).toEqual(expect.arrayContaining(['brand-storytelling-lab', 'pricing-with-confidence']));
  });

  it('shows the bump offer’s copy and discount', async () => {
    Object.assign(amplify().orderBump!, { headline: 'Add the vault', discountPercent: 25 });
    const b = browser();
    await b.signUp();
    const q = (await b.post('/api/v1/checkout/quote', { target: { kind: 'course', course_slug: 'podcast-launchpad' }, order_bump: true }))
      .json!.data;
    expect(q.order_bump).toMatchObject({
      headline: 'Add the vault',
      price: { amount: 2175 },
      compare_at: { amount: 2900 },
      selected: true,
    });
    expect(q.total.amount).toBe(12900 + 2175);
    expect(q.savings.amount).toBe(725);
  });

  it('gives new subscribers a free trial or a first-month discount', async () => {
    const t = amplify();
    const course = t.courses.find((c) => c.slug === 'podcast-launchpad')!;
    // The seed's course rows outlive reset(): put the pricing back afterwards.
    onTestFinished(() => {
      delete course.pricing;
    });
    course.pricing = { model: 'subscription', monthlyPrice: 3500 };
    const trial = { ...t.offers!.find((o) => o.kind === 'upsell')!, id: 'ofr_trial', kind: 'trial' as const, item: null };
    t.offers!.push({ ...trial, trialMode: 'trial', trialDays: 14, discountPercent: 0, appliesTo: { kind: 'all', courseIds: [] } });
    const b = browser();
    await b.signUp();
    const sub = { kind: 'course', course_slug: 'podcast-launchpad' };
    const q = (await b.post('/api/v1/checkout/quote', { target: sub, coupon_code: 'LAUNCH20' })).json!.data;
    expect(q.due_today.amount).toBe(0);
    expect(q.recurring.trial_days).toBe(14);
    expect(q.save_card).toBe(true);
    expect(q.price_offer).toMatchObject({ kind: 'trial', trial_days: 14, discount_percent: 0 });
    expect(q.coupon).toMatchObject({ valid: false, message: 'Nothing is charged today during the free trial.' });

    Object.assign(t.offers!.at(-1)!, { trialMode: 'first_period', trialDays: null, discountPercent: 50 });
    const first = (await b.post('/api/v1/checkout/quote', { target: sub })).json!.data;
    expect(first.due_today.amount).toBe(1750);
    expect(first.lines[0].compare_at.amount).toBe(3500);
    expect(first.recurring.amount.amount).toBe(3500);
  });
});

describe('post-purchase offers (thank-you page)', () => {
  const buy = async (token = 'tok_visa', email = 'lena@example.com') => {
    const b = browser();
    await b.signUp(email);
    const order = (await b.post('/api/v1/checkout', checkoutBody({ payment_token: token, email }))).json!.data;
    return { b, order };
  };

  it('offers the upsell, then the downsell after “No thanks”, charging the card saved at checkout', async () => {
    const { b, order } = await buy();
    const offer = (await b.get(`/api/v1/orders/${order.id}/offer`)).json!.data;
    expect(offer).toMatchObject({
      key: 'ofr_lab',
      kind: 'upsell',
      headline: 'Add Launch Lab for 20% off',
      item: { kind: 'course', title: 'Launch Lab', slug: 'launch-lab' },
      price: { amount: 11920 },
      compare_at: { amount: 14900 },
      tax: { amount: 0 },
      total: { amount: 11920 },
      card: { brand: 'Visa', last4: '4242' },
    });
    expect(Date.parse(offer.expires_at) - Date.parse(order.paid_at)).toBe(30 * 60_000);

    // Someone else's order; a stale key.
    const jordan = browser();
    await jordan.signIn();
    expect((await jordan.get(`/api/v1/orders/${order.id}/offer`)).status).toBe(403);
    const stale = await b.post(`/api/v1/orders/${order.id}/offer`, { key: 'ofr_other', accept: true });
    expect(stale.status).toBe(409);
    expect(stale.json!.message).toBe('This offer is no longer available.');
    expect((await b.post(`/api/v1/orders/${order.id}/offer`, { accept: true })).json!.errors.key[0]).toBe('The key field is required.');

    const next = (await b.post(`/api/v1/orders/${order.id}/offer`, { key: 'ofr_lab', accept: false })).json!.data;
    expect(next).toMatchObject({
      key: 'ofr_podcast',
      kind: 'downsell',
      headline: '',
      price: { amount: 6450 },
      compare_at: { amount: 12900 },
    });

    const taken = await b.post(`/api/v1/orders/${order.id}/offer`, { key: 'ofr_podcast', accept: true });
    expect(taken.status).toBe(201);
    expect(taken.json!.data).toMatchObject({ status: 'paid', next_action: null, total: { amount: 6450 } });
    expect(amplify().orders.find((o) => o.id === taken.json!.data.id)!.source).toBe('Post-purchase downsell');
    const mine = (await b.get('/api/v1/me/enrollments')).json!.data as Json[];
    expect(mine.some((e) => e.course_slug === 'podcast-launchpad')).toBe(true);
    expect((await b.get(`/api/v1/orders/${order.id}/offer`)).json!.data).toBeNull();
  });

  it('declining the downsell ends the flow', async () => {
    const { b, order } = await buy();
    await b.post(`/api/v1/orders/${order.id}/offer`, { key: 'ofr_lab', accept: false });
    expect((await b.post(`/api/v1/orders/${order.id}/offer`, { key: 'ofr_podcast', accept: false })).json).toEqual({ data: null });
    expect(amplify().orders.find((o) => o.id === order.id)!.offerPaymentReference).toBeNull();
  });

  it('falls back to 3-D Secure, frees a declined charge, and closes after 30 minutes', async () => {
    // Paid with the 3-D Secure test card: its saved reference asks again for the one-click charge.
    const { b, order } = await buy('tok_threeDSecure');
    expect(order.status).toBe('pending');
    expect((await b.get(`/api/v1/orders/${order.id}`)).json!.data.status).toBe('paid');
    const pending = await b.post(`/api/v1/orders/${order.id}/offer`, { key: 'ofr_lab', accept: true });
    expect(pending.status).toBe(201);
    expect(pending.json!.data.status).toBe('pending');
    expect(pending.json!.data.next_action.client_secret).toMatch(/^fake_secret_/);
    expect((await b.get(`/api/v1/orders/${pending.json!.data.id}`)).json!.data.status).toBe('paid');

    // A declined card: nothing taken, the offer stays open.
    const second = await buy('tok_visa', 'max@example.com');
    amplify().orders.find((o) => o.id === second.order.id)!.offerPaymentReference = 'saved_declined_card';
    const declined = await second.b.post(`/api/v1/orders/${second.order.id}/offer`, { key: 'ofr_lab', accept: true });
    expect(declined.status).toBe(422);
    expect(declined.json!.errors.payment_token[0]).toBe('Your card was declined.');
    expect((await second.b.get(`/api/v1/orders/${second.order.id}/offer`)).json!.data.key).toBe('ofr_lab');

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 31 * 60_000);
    expect((await second.b.get(`/api/v1/orders/${second.order.id}/offer`)).json!.data).toBeNull();
    expect((await second.b.post(`/api/v1/orders/${second.order.id}/offer`, { key: 'ofr_lab', accept: true })).status).toBe(409);
  });
});
