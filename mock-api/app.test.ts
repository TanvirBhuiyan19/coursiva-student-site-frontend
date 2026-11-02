/**
 * Contract tests for the API the learner site depends on. They run against the mock, and describe exactly what the
 * Laravel implementation must do: tenant isolation, Sanctum CSRF + session cookies, server-side pricing and grading.
 */
import { app } from './app';
import { allTenants, reset } from './lib/db';

const SERVICE = { Authorization: 'Bearer dev-service-token' };

/** A tiny cookie-jar client, scoped to one tenant — like a browser on that tenant's domain. */
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
  /** Multipart POST (the browser sets the boundary) or a raw-text request. */
  const sendRaw = async (method: string, path: string, body: FormData | string) => {
    const headers: Record<string, string> = { 'X-Tenant': tenant, Accept: 'application/json' };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (typeof body === 'string') headers['Content-Type'] = 'application/json';
    if (jar.has('XSRF-TOKEN')) headers['X-XSRF-TOKEN'] = decodeURIComponent(jar.get('XSRF-TOKEN')!);
    const res = await app.request(path, { method, headers, body: method === 'GET' ? undefined : body });
    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      text,
      json: text.startsWith('{') ? (JSON.parse(text) as Record<string, any>) : null,
    };
  };
  return {
    jar,
    form: (p: string, f: FormData) => sendRaw('POST', p, f),
    raw: (method: string, p: string, json: string) => sendRaw(method, p, json),
    get: (p: string) => send('GET', p),
    post: (p: string, b: unknown = {}) => send('POST', p, b),
    put: (p: string, b: unknown = {}) => send('PUT', p, b),
    patch: (p: string, b: unknown = {}) => send('PATCH', p, b),
    del: (p: string) => send('DELETE', p),
    async signIn(email = 'jordan.tate@gmail.com', password = 'password') {
      await send('GET', '/sanctum/csrf-cookie');
      return send('POST', '/api/v1/auth/login', { email, password, remember: false });
    },
  };
}

beforeEach(() => reset());

describe('platform', () => {
  it('resolves hosts to tenants (subdomain and custom domain), server-to-server only', async () => {
    const sub = await app.request('/platform/v1/domains/resolve?host=amplify.localhost', { headers: SERVICE });
    expect(((await sub.json()) as { data: { tenant: string } }).data.tenant).toBe('amplify');
    const custom = await app.request('/platform/v1/domains/resolve?host=learn.northwindyoga.test', { headers: SERVICE });
    expect(((await custom.json()) as { data: { tenant: string } }).data.tenant).toBe('northwind');
    expect((await app.request('/platform/v1/domains/resolve?host=nope.localhost', { headers: SERVICE })).status).toBe(404);
    expect((await app.request('/platform/v1/domains/resolve?host=amplify.localhost')).status).toBe(401);
  });
  it('returns the tenant languages so the proxy can route /<lang>/ URLs', async () => {
    const res = await app.request('/platform/v1/domains/resolve?host=polyglot.localhost', { headers: SERVICE });
    const { data } = (await res.json()) as { data: { default_locale: string; locales: string[] } };
    expect(data.default_locale).toBe('en-US');
    expect(data.locales).toEqual(['en-US', 'es-ES', 'ar']);
  });
});

describe('tenant isolation', () => {
  it('serves each tenant only its own catalogue', async () => {
    const a = await browser('amplify').get('/api/v1/courses');
    const n = await browser('northwind').get('/api/v1/courses');
    const slugs = (r: typeof a) => (r.json!.data.courses as { slug: string }[]).map((c) => c.slug);
    expect(slugs(a)).toContain('the-funnel-blueprint');
    expect(slugs(n)).toEqual(expect.not.arrayContaining(['the-funnel-blueprint']));
    expect((await browser('northwind').get('/api/v1/courses/the-funnel-blueprint')).status).toBe(404);
  });
  it('gives every outline lesson a summary: its text, or null', async () => {
    const course = (await browser('amplify').get('/api/v1/courses/the-funnel-blueprint')).json!.data;
    const lessons = (course.modules as { lessons: { title: string; summary: string | null }[] }[]).flatMap((m) => m.lessons);
    expect(lessons.every((l) => l.summary === null || typeof l.summary === 'string')).toBe(true);
    expect(lessons.find((l) => l.title === 'The anatomy of a funnel')!.summary).toBe(
      'The four stages every funnel shares, and the one number to watch at each stage.',
    );
    expect(lessons.filter((l) => l.summary !== null).length).toBe(4);
    expect(lessons.find((l) => l.title === 'Pricing psychology')!.summary).toBeNull();
    // Markdown from the rich text editor: line breaks, a list and a link.
    expect(lessons.find((l) => l.title === 'Welcome & how this course works')!.summary).toMatch(
      /^A \*\*quick tour\*\* of the course:\n\n- /,
    );
  });
  it('does not accept a session from another tenant', async () => {
    const amp = browser('amplify');
    expect((await amp.signIn()).status).toBe(200);
    const stolen = browser('northwind');
    for (const [k, v] of amp.jar) stolen.jar.set(k, v);
    expect((await stolen.get('/api/v1/me')).status).toBe(401);
  });
  it('rejects unknown tenants', async () => {
    expect((await browser('ghost').get('/api/v1/site')).status).toBe(404);
  });
  it('hides features the plan lacks', async () => {
    expect((await browser('northwind').get('/api/v1/membership')).status).toBe(404);
    expect((await browser('northwind').get('/api/v1/community')).status).toBe(404);
  });
});

describe('auth (Sanctum SPA)', () => {
  it('requires a CSRF token for mutations', async () => {
    const b = browser('amplify');
    const res = await b.post('/api/v1/auth/login', { email: 'jordan.tate@gmail.com', password: 'password' });
    expect(res.status).toBe(419);
  });
  it('signs in, reports the learner, and signs out', async () => {
    const b = browser('amplify');
    expect((await b.get('/api/v1/me')).status).toBe(401);
    const login = await b.signIn();
    expect(login.json!.data.name).toBe('Jordan Tate');
    expect(b.jar.has('coursiva_session')).toBe(true);
    expect((await b.get('/api/v1/me')).json!.data.email).toBe('jordan.tate@gmail.com');
    await b.post('/api/v1/auth/logout');
    expect((await b.get('/api/v1/me')).status).toBe(401);
  });
  it('returns field errors as 422', async () => {
    const res = await browser('amplify').signIn('jordan.tate@gmail.com', 'wrong-password');
    expect(res.status).toBe(422);
    expect(res.json!.errors.email[0]).toMatch(/don’t match/);
  });
  it('keeps a new email pending until confirmed, and needs the current password for it', async () => {
    const b = browser('amplify');
    await b.signIn();
    const profile = (await b.get('/api/v1/me/profile')).json!.data as Record<string, unknown>;
    expect(profile.pending_email).toBeNull();
    const change = {
      name: profile.name,
      email: 'jordan.new@example.com',
      bio: profile.bio,
      timezone: profile.timezone,
      website: profile.website,
    };
    const missing = await b.patch('/api/v1/me/profile', change);
    expect(missing.status).toBe(422);
    expect(missing.json!.errors.current_password[0]).toBe('The current password field is required when changing your email.');
    expect((await b.patch('/api/v1/me/profile', { ...change, current_password: 'nope' })).json!.errors.current_password[0]).toBe(
      'The current password is incorrect.',
    );
    const saved = await b.patch('/api/v1/me/profile', { ...change, current_password: 'password' });
    expect(saved.json!.data).toMatchObject({ email: 'jordan.tate@gmail.com', pending_email: 'jordan.new@example.com' });
    // Back to the confirmed address: the pending change is dropped, no password needed.
    const back = await b.patch('/api/v1/me/profile', { ...change, email: 'jordan.tate@gmail.com' });
    expect(back.json!.data).toMatchObject({ email: 'jordan.tate@gmail.com', pending_email: null });
  });
  it('never reveals whether an account exists on password reset', async () => {
    const b = browser('amplify');
    await b.get('/sanctum/csrf-cookie');
    expect((await b.post('/api/v1/auth/forgot-password', { email: 'nobody@example.com' })).status).toBe(200);
  });
  it('merges a guest cart into the account on sign-in', async () => {
    const b = browser('amplify');
    await b.get('/sanctum/csrf-cookie');
    await b.post('/api/v1/cart/items', { course_slug: 'podcast-launchpad' });
    await b.signIn();
    const cart = await b.get('/api/v1/cart');
    expect((cart.json!.data.items as { course_slug: string }[]).map((i) => i.course_slug)).toEqual([
      'client-acquisition-sprint',
      'podcast-launchpad',
    ]);
  });
});

describe('checkout (server-side pricing)', () => {
  const quote = async (body: object) => {
    const b = browser('amplify');
    await b.get('/sanctum/csrf-cookie');
    return (await b.post('/api/v1/checkout/quote', body)).json!.data;
  };
  const target = { kind: 'course', course_slug: 'the-funnel-blueprint' };

  it('prices a course, a coupon, VAT and an instalment plan', async () => {
    expect((await quote({ target, plan: 'full', seats: 1, country: 'United States' })).total.amount).toBe(24900);
    const coupon = await quote({ target, plan: 'full', coupon_code: 'launch20', seats: 1, country: 'United States' });
    expect(coupon.discount.amount).toBe(5000);
    expect(coupon.coupon.valid).toBe(true);
    const vat = await quote({ target, plan: 'full', seats: 1, country: 'United Kingdom' });
    expect(vat.tax_label).toBe('VAT (20%)');
    expect(vat.total.amount).toBe(29880);
    const plan = await quote({ target, plan: 'installments', seats: 1, country: 'United States' });
    expect(plan.installments).toEqual({ count: 3, amount: { amount: 8800, currency: 'USD' } });
    expect(plan.due_today.amount).toBe(8800);
  });
  it('multiplies by seats and flags invalid coupons', async () => {
    const q = await quote({ target, plan: 'full', seats: 3, coupon_code: 'NOPE', country: 'United States' });
    expect(q.subtotal.amount).toBe(74700);
    expect(q.coupon).toEqual({ code: 'NOPE', valid: false, message: 'That code isn’t valid' });
  });
  it('needs only the chosen kind’s field: a cart ignores course_slug, a course without one is a 422', async () => {
    const b = browser('amplify');
    await b.get('/sanctum/csrf-cookie');
    expect((await b.post('/api/v1/cart/items', { course_slug: 'the-funnel-blueprint' })).status).toBe(201);
    expect((await b.post('/api/v1/checkout/quote', { target: { kind: 'cart', course_slug: null } })).status).toBe(200);
    const missing = await b.post('/api/v1/checkout/quote', { target: { kind: 'course', course_slug: null } });
    expect(missing.status).toBe(422);
    expect(missing.json!.errors).toEqual({ 'target.course_slug': ['Choose the course to buy.'] });
  });
  it('requires sign-in, a card token and accepted terms, then enrols the buyer', async () => {
    const b = browser('amplify');
    await b.get('/sanctum/csrf-cookie');
    const body = {
      target: { kind: 'course', course_slug: 'client-acquisition-sprint' },
      plan: 'full',
      seats: 1,
      country: 'United States',
      name: 'Jordan Tate',
      email: 'jordan.tate@gmail.com',
      payment_method: 'card',
      payment_token: 'tok_visa',
      accept_terms: true,
    };
    expect((await b.post('/api/v1/checkout', body)).status).toBe(401);
    await b.signIn();
    expect((await b.post('/api/v1/checkout', { ...body, accept_terms: false })).status).toBe(422);
    expect((await b.post('/api/v1/checkout', { ...body, payment_token: 'tok_chargeDeclined' })).json!.errors.payment_token[0]).toMatch(
      /declined/,
    );
    // `ref_click` (≤ 32) travels with `ref`; the partner is credited only for its own recorded click.
    expect((await b.post('/api/v1/checkout', { ...body, ref: 'maya', ref_click: 'x'.repeat(33) })).json!.errors.ref_click).toBeDefined();
    const click = (await b.post('/api/v1/affiliates/maya/clicks')).json!.data.click_id as string;
    const order = await b.post('/api/v1/checkout', { ...body, ref: 'maya', ref_click: click });
    expect(order.status).toBe(201);
    expect(order.json!.data.total.amount).toBe(14900);
    const row = allTenants()
      .find((x) => x.site.slug === 'amplify')!
      .orders.find((o) => o.id === order.json!.data.id);
    expect(row).toMatchObject({ ref: 'maya', refClick: click, refCredited: true });
    expect(order.json!.data.start_lesson.course_slug).toBe('client-acquisition-sprint');
    const mine = await b.get('/api/v1/me/enrollments');
    expect((mine.json!.data as { course_slug: string }[]).some((e) => e.course_slug === 'client-acquisition-sprint')).toBe(true);
    expect((await b.post('/api/v1/checkout', body)).json!.errors.target[0]).toMatch(/already own/);
  });
  it('honours the course’s pricing model: subscription, pay what you want, membership-only (never from the cart)', async () => {
    const t = allTenants().find((x) => x.site.slug === 'amplify')!;
    // The seed's course rows outlive reset(): put their pricing back afterwards.
    const changed: (typeof t.courses)[number][] = [];
    onTestFinished(() => changed.forEach((c) => delete c.pricing));
    const set = (slug: string, pricing: (typeof t.courses)[number]['pricing']) => {
      const row = t.courses.find((c) => c.slug === slug)!;
      changed.push(row);
      row.pricing = pricing;
    };
    set('podcast-launchpad', { model: 'subscription', monthlyPrice: 3500 });
    set('client-acquisition-sprint', { model: 'pay_what_you_want', minimumPrice: 1000 });
    set('pricing-with-confidence', { model: 'membership' });
    const b = browser('amplify');
    await b.signIn();
    const sub = { kind: 'course', course_slug: 'podcast-launchpad' };
    const card = (await b.get('/api/v1/courses/podcast-launchpad')).json!.data;
    expect(card.price.amount).toBe(3500);
    expect(card.pricing).toEqual({ model: 'subscription', interval: 'month', minimum_price: null });
    expect(card.payment_plan).toBeNull();
    const q = (await b.post('/api/v1/checkout/quote', { target: sub, country: 'United Kingdom' })).json!.data;
    expect(q.due_today.amount).toBe(4200);
    expect(q.recurring).toEqual({ interval: 'month', amount: { amount: 4200, currency: 'USD' }, trial_days: 0 });
    expect(q.installment_option).toBeNull();
    expect((await b.post('/api/v1/checkout/quote', { target: sub, seats: 2 })).json!.errors.target[0]).toMatch(
      /subscription can’t be bought/,
    );
    expect((await b.post('/api/v1/cart/items', { course_slug: 'podcast-launchpad' })).status).toBe(422);

    const pwyw = { kind: 'course', course_slug: 'client-acquisition-sprint' };
    const suggested = (await b.post('/api/v1/checkout/quote', { target: pwyw })).json!.data;
    expect(suggested.pay_what_you_want.minimum.amount).toBe(1000);
    expect(suggested.pay_what_you_want.message).toBeNull();
    const low = (await b.post('/api/v1/checkout/quote', { target: pwyw, amount: 500 })).json!.data;
    expect(low.pay_what_you_want.message).toBe('Pay at least $10.');
    const body = { plan: 'full', seats: 1, country: 'United States', name: 'Jordan Tate', email: 'jordan.tate@gmail.com' };
    const pay = { payment_method: 'card', payment_token: 'tok_visa', accept_terms: true };
    expect((await b.post('/api/v1/checkout', { ...body, ...pay, target: pwyw, amount: 500 })).json!.errors.amount[0]).toBe(
      'Pay at least $10.',
    );
    const paid = await b.post('/api/v1/checkout', { ...body, ...pay, target: pwyw, amount: 1500 });
    expect(paid.status).toBe(201);
    expect(paid.json!.data.total.amount).toBe(1500);

    const members = await b.post('/api/v1/checkout/quote', { target: { kind: 'course', course_slug: 'pricing-with-confidence' } });
    expect(members.json!.errors.target[0]).toMatch(/comes with a membership/);
    expect((await b.post('/api/v1/cart/items', { course_slug: 'pricing-with-confidence' })).status).toBe(422);
  });
  it('accepts first-touch acquisition hints with the checkout', async () => {
    const b = browser('amplify');
    await b.signIn();
    const order = await b.post('/api/v1/checkout', {
      target: { kind: 'course', course_slug: 'client-acquisition-sprint' },
      plan: 'full',
      seats: 1,
      country: 'United States',
      name: 'Jordan Tate',
      email: 'jordan.tate@gmail.com',
      payment_method: 'card',
      payment_token: 'tok_visa',
      accept_terms: true,
      acquisition: {
        utm_source: 'newsletter',
        utm_medium: 'email',
        utm_campaign: 'spring-launch',
        referrer: 'https://www.google.com',
        gclid: 'abc',
        fbclid: 'IwAR1',
        ttclid: 'tt1',
        li_fat_id: 'li1',
        msclkid: 'ms1',
        epik: 'ep1',
        twclid: 'tw1',
      },
    });
    expect(order.status).toBe(201);
  });
  it('validates acquisition hint lengths like the API', async () => {
    const b = browser('amplify');
    await b.signIn();
    const checkout = (acquisition: Record<string, unknown>) =>
      b.post('/api/v1/checkout', {
        target: { kind: 'course', course_slug: 'the-funnel-blueprint' },
        plan: 'full',
        seats: 1,
        country: 'United States',
        name: 'Jordan Tate',
        email: 'jordan.tate@gmail.com',
        payment_method: 'card',
        payment_token: 'tok_visa',
        accept_terms: true,
        acquisition,
      });
    const campaign = await checkout({ utm_campaign: 'c'.repeat(101) });
    expect(campaign.status).toBe(422);
    expect(campaign.json!.errors).toHaveProperty(['acquisition.utm_campaign']);
    for (const id of ['gclid', 'fbclid', 'ttclid', 'li_fat_id', 'msclkid', 'epik', 'twclid']) {
      const res = await checkout({ [id]: 'x'.repeat(id === 'fbclid' ? 501 : 201) });
      expect(res.status).toBe(422);
      expect(res.json!.errors).toHaveProperty([`acquisition.${id}`]);
    }
    expect((await checkout({ referrer: 'https://x.test/'.padEnd(501, 'x') })).status).toBe(422);
  });
});

describe('tax at checkout (TaxEngine: registrations, reverse charge, states, invoice numbers)', () => {
  const funnel = { kind: 'course', course_slug: 'the-funnel-blueprint' }; // amplify, $249
  const yoga = { kind: 'course', course_slug: 'yoga-foundations' }; // northwind, £89
  const pay = { plan: 'full', seats: 1, name: 'Jordan Tate', email: 'jordan.tate@gmail.com', payment_method: 'card', accept_terms: true };
  const noTax = {
    inclusive: false,
    rate: null,
    reverse_charge: false,
    region: null,
    provider: null,
    note: null,
    accepts_tax_id: false,
    region_required: false,
    tax_id: null,
  };
  const quoter = async (tenant: string) => {
    const b = browser(tenant);
    await b.get('/sanctum/csrf-cookie');
    return async (body: object) => (await b.post('/api/v1/checkout/quote', body)).json!.data;
  };

  it('adds UK VAT on top (exclusive), lists states and provinces, and taxes nothing where the school isn’t registered', async () => {
    const quote = await quoter('amplify');
    const uk = await quote({ target: funnel, country: 'United Kingdom' });
    expect(uk.tax).toEqual({ amount: 4980, currency: 'USD' });
    expect(uk.tax_label).toBe('VAT (20%)');
    expect(uk.total.amount).toBe(29880);
    expect(uk.tax_details).toEqual({ ...noTax, rate: 20, region: 'United Kingdom', provider: 'builtin' });
    expect(uk.subdivisions).toHaveLength(64);
    expect(uk.subdivisions).toContainEqual({ country: 'United States', code: 'CA', name: 'California' });
    expect(uk.subdivisions).toContainEqual({ country: 'Canada', code: 'ON', name: 'Ontario' });
    const us = await quote({ target: funnel, country: 'United States', region: 'TX' });
    expect([us.tax.amount, us.tax_label, us.total.amount]).toEqual([0, null, 24900]);
    expect(us.tax_details).toEqual(noTax);
    // A VAT number where reverse charge doesn't apply is ignored.
    expect((await quote({ target: funnel, country: 'United Kingdom', tax_id: 'GB999999973' })).tax_details.tax_id).toBeNull();
    // An instalment carries its share of the added VAT; `tax` is the whole order's.
    const plan = await quote({ target: funnel, plan: 'installments', country: 'United Kingdom' });
    expect(plan.tax.amount).toBe(5280);
    expect(plan.total.amount).toBe(31680);
    expect(plan.installments.amount.amount).toBe(10560);
    expect(plan.due_today.amount).toBe(10560);
  });
  it('charges EU VAT through the OSS and reverse-charges a verified VAT number (fake VIES)', async () => {
    const quote = await quoter('amplify');
    const de = await quote({ target: funnel, country: 'Germany' });
    expect(de.tax_label).toBe('VAT (19%)');
    expect(de.tax.amount).toBe(4731);
    expect(de.tax_details).toMatchObject({ region: 'European Union (OSS)', accepts_tax_id: true, reverse_charge: false, tax_id: null });
    const valid = await quote({ target: funnel, country: 'Germany', tax_id: 'de 123.456-789' });
    expect([valid.tax.amount, valid.tax_label, valid.total.amount]).toEqual([0, 'Reverse charge', 24900]);
    expect(valid.tax_details).toMatchObject({
      reverse_charge: true,
      note: 'VAT reverse charge: the customer accounts for VAT (Article 196, Council Directive 2006/112/EC).',
      tax_id: { status: 'valid', message: null },
    });
    const unknown = await quote({ target: funnel, country: 'Germany', tax_id: 'DE123456000' });
    expect(unknown.tax_details.tax_id).toEqual({ status: 'invalid', message: 'This VAT number isn’t registered in VIES.' });
    expect(unknown.tax.amount).toBe(4731);
    const down = await quote({ target: funnel, country: 'Germany', tax_id: 'DE123456999' });
    expect(down.tax_details.tax_id).toEqual({
      status: 'unverified',
      message: 'We couldn’t verify this VAT number right now, so VAT is charged.',
    });
    const bad = await quote({ target: funnel, country: 'Germany', tax_id: 'FR12' });
    expect(bad.tax_details.tax_id).toEqual({ status: 'invalid', message: 'Enter a valid Germany VAT number.' });
  });
  it('extracts GST from prices that include it, and asks US buyers for their state where a state is registered', async () => {
    const quote = await quoter('northwind');
    const au = await quote({ target: yoga, country: 'Australia' });
    expect([au.tax.amount, au.tax_label, au.total.amount]).toEqual([809, 'GST (10%)', 8900]);
    expect(au.tax_details).toMatchObject({ inclusive: true, rate: 10, region: 'Australia' });
    const noState = await quote({ target: yoga, country: 'United States' });
    expect(noState.tax_details.region_required).toBe(true);
    expect(noState.tax.amount).toBe(0);
    const ca = await quote({ target: yoga, country: 'United States', region: 'CA' });
    expect([ca.tax.amount, ca.tax_label, ca.total.amount]).toEqual([645, 'Sales tax (7.25%)', 9545]);
    expect(ca.tax_details).toMatchObject({ region: 'United States — California', region_required: false });
    const ny = await quote({ target: yoga, country: 'United States', region: 'NY' });
    expect([ny.tax.amount, ny.tax_details.region_required]).toEqual([0, false]);
    const b = browser('northwind');
    await b.get('/sanctum/csrf-cookie');
    const wrong = await b.post('/api/v1/checkout/quote', { target: yoga, country: 'United States', region: 'ZZ' });
    expect(wrong.status).toBe(422);
    expect(wrong.json!.errors).toEqual({ region: ['Choose a state or province from the list.'] });
    expect((await b.post('/api/v1/checkout/quote', { target: yoga, country: 'United States', tax_id: 'x'.repeat(33) })).status).toBe(422);
  });
  it('refuses a checkout without the required state, then stores the tax and numbers the invoice once paid', async () => {
    const b = browser('northwind');
    await b.get('/sanctum/csrf-cookie');
    await b.post('/api/v1/auth/register', { name: 'Nia Park', email: 'nia@example.com', password: 'password-123' });
    const body = { ...pay, target: yoga, country: 'United States', payment_token: 'tok_visa' };
    const missing = await b.post('/api/v1/checkout', body);
    expect(missing.status).toBe(422);
    expect(missing.json!.errors.region).toEqual(['Choose your state or province.']);
    const pending = await b.post('/api/v1/checkout', { ...body, region: 'ca', payment_token: 'tok_threeDSecure' });
    expect(pending.status).toBe(201);
    expect(pending.json!.data.invoice_number).toBeNull();
    const order = (await b.get(`/api/v1/orders/${pending.json!.data.id}`)).json!.data;
    expect(order.invoice_number).toBe('INV-0001');
    expect(order.tax).toEqual({ amount: 645, currency: 'GBP' });
    expect(order.tax_label).toBe('Sales tax (7.25%)');
    expect(order.tax_details).toEqual({ inclusive: false, rate: 7.25, reverse_charge: false, note: null });
    expect(order.items[0].tax).toEqual({ amount: 645, currency: 'GBP' });
    expect(order.billing).toMatchObject({ country: 'United States', region: 'CA', tax_id: null });
    expect(order.total.amount).toBe(9545);

    const a = browser('amplify');
    await a.signIn();
    const rc = await a.post('/api/v1/checkout', {
      ...pay,
      target: { kind: 'course', course_slug: 'client-acquisition-sprint' },
      country: 'Germany',
      tax_id: 'DE123456789',
      payment_token: 'tok_visa',
    });
    expect(rc.status).toBe(201);
    expect(rc.json!.data).toMatchObject({
      invoice_number: 'INV-0001',
      tax_label: 'Reverse charge',
      tax: { amount: 0 },
      tax_details: { reverse_charge: true, rate: 19 },
      billing: { country: 'Germany', region: null, tax_id: 'DE123456789' },
      seller: { tax_id: 'EU372000041' },
    });
    const uk = await a.post('/api/v1/checkout', {
      ...pay,
      target: { kind: 'course', course_slug: 'podcast-launchpad' },
      country: 'United Kingdom',
      payment_token: 'tok_visa',
    });
    expect(uk.json!.data.invoice_number).toBe('INV-0002');
    expect(uk.json!.data.seller.tax_id).toBe('GB123456789');
  });
});

describe('gift cards at checkout (Laravel GiftCardRules / GiftCards)', () => {
  const course = { kind: 'course', course_slug: 'pricing-with-confidence' }; // $99
  const product = { kind: 'product', product_slug: 'launch-kit' }; // $19
  const order = (target: object, extra: object = {}) => ({
    target,
    plan: 'full',
    seats: 1,
    country: 'United States',
    name: 'Jordan Tate',
    email: 'jordan.tate@gmail.com',
    payment_method: 'card',
    payment_token: 'tok_visa',
    accept_terms: true,
    ...extra,
  });

  it('quotes the card as a tender after the total, reporting refusals without a 422', async () => {
    const b = browser('amplify');
    await b.get('/sanctum/csrf-cookie');
    const quote = async (body: object) => (await b.post('/api/v1/checkout/quote', body)).json!.data;
    const half = await quote({ target: course, gift_card: 'gift half 0025' });
    expect(half.gift_card).toEqual({
      code: 'GIFT-••••-0025',
      valid: true,
      message: 'Gift card applied: $25',
      applied: { amount: 2500, currency: 'USD' },
      remaining: { amount: 0, currency: 'USD' },
    });
    expect(half.due_today.amount).toBe(9900);
    expect(half.pay_today.amount).toBe(7400);
    expect((await quote({ target: course, gift_card: 'GIFT-NOPE-NOPE' })).gift_card).toMatchObject({
      valid: false,
      message: 'This gift card isn’t valid.',
      remaining: null,
    });
    expect((await quote({ target: course, gift_card: 'hello' })).gift_card).toMatchObject({ code: 'hello', valid: false });
    expect((await quote({ target: course, gift_card: 'GIFT-USED-0000' })).gift_card.message).toBe('This gift card has no balance left.');
    expect((await quote({ target: course, plan: 'installments', gift_card: 'GIFT-TEST-0050' })).gift_card.message).toBe(
      'Gift cards can’t be used with payment plans.',
    );
    expect((await quote({ target: course })).gift_card).toBeNull();
    const many = await b.post('/api/v1/checkout/quote', { target: course, gift_card: ['GIFT-TEST-0050', 'GIFT-HALF-0025'] });
    expect(many.status).toBe(422);
    expect(many.json!.errors).toEqual({ gift_card: ['Only one gift card can be used per order.'] });
  });

  it('completes a fully covered order without a card token, and charges only the rest on a split', async () => {
    const b = browser('amplify');
    await b.signIn();
    const covered = await b.post('/api/v1/checkout', order(product, { payment_token: null, gift_card: 'GIFT-TEST-0050' }));
    expect(covered.status).toBe(201);
    expect(covered.json!.data).toMatchObject({
      status: 'paid',
      payment_method: 'Gift card',
      gift_card: { code: 'GIFT-••••-0050', amount: { amount: 1900 }, refunded: { amount: 0 } },
      paid_by_card: { amount: 0 },
    });
    // $50 − $19 = $31 left.
    const left = (await b.post('/api/v1/checkout/quote', { target: course, gift_card: 'GIFT-TEST-0050' })).json!.data;
    expect(left.gift_card.applied.amount).toBe(3100);

    const split = await b.post('/api/v1/checkout', order(course, { gift_card: 'GIFT-HALF-0025' }));
    expect(split.status).toBe(201);
    expect(split.json!.data.paid_by_card.amount).toBe(7400);
    expect(split.json!.data.payment_method).not.toBe('Gift card');
    expect((await b.post('/api/v1/checkout/quote', { target: course, gift_card: 'GIFT-HALF-0025' })).json!.data.gift_card.message).toBe(
      'This gift card has no balance left.',
    );
  });

  it('leaves the balance untouched on a decline, and holds through 3-D Secure until the order is read', async () => {
    const b = browser('amplify');
    await b.signIn();
    const declined = await b.post('/api/v1/checkout', order(course, { payment_token: 'tok_chargeDeclined', gift_card: 'GIFT-HALF-0025' }));
    expect(declined.status).toBe(422);
    const quote = async () =>
      (await b.post('/api/v1/checkout/quote', { target: product, gift_card: 'GIFT-HALF-0025' })).json!.data.gift_card;
    expect((await quote()).valid).toBe(true);

    const pending = await b.post('/api/v1/checkout', order(course, { payment_token: 'tok_threeDSecure', gift_card: 'GIFT-HALF-0025' }));
    expect(pending.json!.data.status).toBe('pending');
    expect((await quote()).message).toBe('This gift card’s balance is in use by another checkout. Try again later.');
    expect((await b.get(`/api/v1/orders/${pending.json!.data.id}`)).json!.data.status).toBe('paid');
    expect((await quote()).message).toBe('This gift card has no balance left.');

    // A refusal at checkout is a 422 gift_card.
    const refused = await b.post('/api/v1/checkout', order(product, { gift_card: 'GIFT-HALF-0025' }));
    expect(refused.status).toBe(422);
    expect(refused.json!.errors.gift_card[0]).toBe('This gift card has no balance left.');
  });
});

describe('analytics collection', () => {
  const pageview = (headers: Record<string, string>, payload: unknown) =>
    app.request('/api/v1/analytics/pageviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
  const view = { path: '/courses/the-funnel-blueprint', visitor_ip: '203.0.113.7', user_agent: 'Mozilla/5.0' };

  it('takes page views from the site server only (service token + X-Tenant) and answers 204', async () => {
    expect((await pageview({ ...SERVICE, 'X-Tenant': 'amplify' }, view)).status).toBe(204);
    expect(
      (await pageview({ ...SERVICE, 'X-Tenant': 'amplify' }, { ...view, path: '/checkout?course=x', visitor_ip: '2001:db8::1' })).status,
    ).toBe(204);
    expect((await pageview({ ...SERVICE, 'X-Tenant': 'amplify' }, { ...view, referrer: 'https://www.google.com/' })).status).toBe(204);
    expect((await pageview({ ...SERVICE, 'X-Tenant': 'amplify' }, { ...view, referrer: null })).status).toBe(204);
    expect((await pageview({ Authorization: 'Bearer not-the-service-token', 'X-Tenant': 'amplify' }, view)).status).toBe(401);
    expect((await pageview({ ...SERVICE, 'X-Tenant': 'ghost' }, view)).status).toBe(404);
  });
  it('validates the page view body', async () => {
    const h = { ...SERVICE, 'X-Tenant': 'amplify' };
    expect((await pageview(h, { ...view, path: 'courses' })).status).toBe(422);
    expect((await pageview(h, { ...view, visitor_ip: '' })).status).toBe(422);
    expect((await pageview(h, { ...view, user_agent: 'x'.repeat(501) })).status).toBe(422);
    expect((await pageview(h, { ...view, referrer: `https://www.google.com/${'q'.repeat(2000)}` })).status).toBe(422);
    expect((await pageview(h, { ...view, referrer: 42 })).status).toBe(422);
  });
  it('takes playback reports for video lessons the learner can open', async () => {
    const b = browser('amplify');
    const report = {
      session: 'b6f1c7e2-6d1f-4c3e-9a51-0f1e2d3c4b5a',
      device: 'web',
      segments: [
        [0, 14.5],
        [10, 20],
      ],
    };
    const course = async (slug: string) =>
      ((await b.get(`/api/v1/me/courses/${slug}`)).json!.data.modules as { lessons: { id: string; type: string }[] }[]).flatMap(
        (m) => m.lessons,
      );
    await b.get('/sanctum/csrf-cookie');
    expect((await b.post('/api/v1/me/lessons/les_e_1_1/playback', report)).status).toBe(401);
    await b.signIn();
    const lessons = await course('email-marketing-mastery');
    const video = lessons.find((l) => l.type === 'video')!;
    const quiz = lessons.find((l) => l.type === 'quiz')!;
    // Lessons carry the sanitised Markdown body and the External/Coaching link (null when the type has none).
    expect((await b.get(`/api/v1/me/lessons/${video.id}`)).json!.data).toMatchObject({ body_html: null, link: null });
    const played = await b.post(`/api/v1/me/lessons/${video.id}/playback`, report);
    expect(played.status).toBe(200);
    expect(played.json!.data.completion).toMatchObject({ rule: 'manual', progress: null });
    expect((await b.post(`/api/v1/me/lessons/${video.id}/playback`, { ...report, device: 'tablet', segments: [] })).status).toBe(200);
    expect((await b.post(`/api/v1/me/lessons/${quiz.id}/playback`, report)).status).toBe(404);
    expect((await b.post('/api/v1/me/lessons/les_nope/playback', report)).status).toBe(404);
    expect((await b.post(`/api/v1/me/lessons/${video.id}/playback`, { ...report, session: 'short' })).status).toBe(422);
    expect((await b.post(`/api/v1/me/lessons/${video.id}/playback`, { ...report, device: 'tv' })).status).toBe(422);
    expect((await b.post(`/api/v1/me/lessons/${video.id}/playback`, { ...report, segments: [[0]] })).status).toBe(422);
    expect((await b.post(`/api/v1/me/lessons/${video.id}/playback`, { ...report, segments: Array(51).fill([0, 1]) })).status).toBe(422);
  });
  it('refuses playback for lessons of courses the learner does not own', async () => {
    const b = browser('amplify');
    await b.signIn();
    const course = allTenants()
      .find((t) => t.site.slug === 'amplify')!
      .courses.find((x) => x.slug === 'podcast-launchpad')!;
    const locked = course.modules.flatMap((m) => m.lessons).find((l) => l.type === 'video' && !l.freePreview)!;
    expect((await b.post(`/api/v1/me/lessons/${locked.id}/playback`, { session: 'abcdefgh', segments: [[0, 5]] })).status).toBe(403);
  });
});

describe('course preview (GET /courses/{slug}/preview)', () => {
  const amplifyCourse = (slug: string) =>
    allTenants()
      .find((t) => t.site.slug === 'amplify')!
      .courses.find((x) => x.slug === slug)!;
  /** Changes a seeded lesson for one test (seed rows are shared across resets, so it is put back afterwards). */
  const undo: (() => void)[] = [];
  const patchPreview = (slug: string, changes: Partial<ReturnType<typeof amplifyCourse>['modules'][number]['lessons'][number]>) => {
    const lesson = amplifyCourse(slug).modules[0]!.lessons[0]!;
    const before = { ...lesson };
    Object.assign(lesson, changes);
    undo.push(() => Object.assign(lesson, before));
  };
  afterEach(() =>
    undo
      .splice(0)
      .reverse()
      .forEach((f) => f()),
  );

  it('serves the free-preview video to guests, uncached: the lesson payload’s video block, never a watermark', async () => {
    const b = browser('amplify');
    const detail = (await b.get('/api/v1/courses/the-funnel-blueprint')).json!.data;
    expect(detail.preview).toEqual({ lesson_id: 'les_f_0_0', title: expect.any(String), type: 'video', poster_url: null });
    expect((detail.previews as { lesson_id: string; type: string }[]).map((p) => [p.lesson_id, p.type])).toEqual([
      ['les_f_0_0', 'video'],
      ['les_f_0_2', 'pdf'],
      ['les_f_0_3', 'quiz'],
    ]);

    const res = await b.raw('GET', '/api/v1/courses/the-funnel-blueprint/preview', '');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const preview = res.json!.data;
    expect(preview).toEqual({
      lesson_id: 'les_f_0_0',
      title: detail.preview.title,
      type: 'video',
      format: 'video',
      duration_seconds: 252,
      poster_url: null,
      video: {
        hls_url: null,
        poster_url: null,
        captions: [],
        drm: null,
        url: null,
        embed_url: 'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ',
        watermark: null,
      },
      blocks: expect.any(Array),
      blocks_locked: 4,
      body_html: null,
      pdf: null,
      file: null,
      link: null,
      resources: [],
      summary: null,
      course: { slug: 'the-funnel-blueprint', title: detail.title },
    });
    expect(preview.blocks[0]).toEqual({ id: 'blk_demo000000000001', type: 'heading', text: 'What you’ll build', level: 2 });
    // Exactly the objects the lesson endpoint returns (sorting items are shuffled per learner).
    await b.signIn();
    const lesson = (await b.get('/api/v1/me/lessons/les_f_0_0')).json!.data;
    expect(lesson.video).toEqual(preview.video);
    const unshuffled = (blocks: Record<string, any>[]) =>
      blocks.map((x) =>
        x.type === 'sorting' ? { ...x, items: [...(x.items as { id: string }[])].sort((p, q) => p.id.localeCompare(q.id)) } : x,
      );
    expect(unshuffled(lesson.blocks)).toEqual(unshuffled(preview.blocks));
    expect(lesson.blocks_locked).toBe(preview.blocks_locked);
  });

  it('ignores a session: a protected video’s preview carries no watermark', async () => {
    patchPreview('launch-lab', { embedUrl: 'https://player.vimeo.com/video/76979871' });
    const b = browser('amplify');
    await b.signIn();
    expect((await b.get('/api/v1/me/lessons/les_l_0_0')).json!.data.video.watermark).not.toBeNull();
    const preview = (await b.get('/api/v1/courses/launch-lab/preview')).json!.data;
    expect(preview.video).toMatchObject({ embed_url: 'https://player.vimeo.com/video/76979871', watermark: null });
  });

  it('serves every free preview by ?lesson=: a PDF viewer, a quiz summary without answers, a text lesson’s blocks', async () => {
    const b = browser('amplify');
    const pdf = (await b.get('/api/v1/courses/the-funnel-blueprint/preview?lesson=les_f_0_2')).json!.data;
    expect(pdf).toMatchObject({ lesson_id: 'les_f_0_2', type: 'pdf', format: 'pdf', video: null, summary: null });
    expect(pdf.pdf).toMatchObject({ url: '/api/v1/courses/the-funnel-blueprint/preview/files/les_f_0_2', downloadable: true });
    const file = await b.raw('GET', pdf.pdf.url, '');
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/pdf');

    const quiz = await b.raw('GET', '/api/v1/courses/the-funnel-blueprint/preview?lesson=les_f_0_3', '');
    expect(quiz.json!.data.summary).toEqual({
      kind: 'quiz',
      question_count: 3,
      pass_percent: 70,
      time_limit_minutes: null,
      attempts_allowed: null,
      points: null,
      starts_at: null,
      duration_minutes: null,
    });
    expect(quiz.text).not.toContain('primary job of the top of your funnel');

    const text = (await b.get('/api/v1/courses/launch-lab/preview?lesson=les_l_2_2')).json!.data;
    expect(text).toMatchObject({ type: 'text', format: 'text', video: null, body_html: null });
    expect((text.blocks as { type: string }[]).map((x) => x.type)).toEqual(['text', 'check', 'check']);
    expect(JSON.stringify(text.blocks)).not.toMatch(/correct|answers|feedback/);

    // A paid lesson, another course's free lesson or an array id: the same 404.
    for (const q of ['les_f_0_1', 'les_l_2_2']) {
      const res = await b.raw('GET', `/api/v1/courses/the-funnel-blueprint/preview?lesson=${q}`, '');
      expect(res.status).toBe(404);
      expect(res.json!.message).toBe('This course has no preview.');
    }
    expect((await b.raw('GET', '/api/v1/courses/the-funnel-blueprint/preview?lesson[]=les_f_0_2', '')).status).toBe(404);
    expect((await b.raw('GET', '/api/v1/courses/the-funnel-blueprint/preview/files/les_f_0_1', '')).status).toBe(404);
  });

  it('is 404 “This course has no preview.” for unknown courses, unplayable videos and courses without previews', async () => {
    const b = browser('amplify');
    const nope = await b.raw('GET', '/api/v1/courses/nope/preview', '');
    expect(nope.status).toBe(404);
    expect(nope.headers.get('cache-control')).toBe('private, no-store');
    expect(nope.json!.message).toBe('This course has no preview.');

    // A video preview with no media yet (no transcode, file or embed) is no preview — never an empty player.
    expect((await b.get('/api/v1/courses/podcast-launchpad')).json!.data.preview.type).toBe('video');
    expect((await b.get('/api/v1/courses/podcast-launchpad/preview')).json).toMatchObject({ message: 'This course has no preview.' });

    // A PDF first preview now opens (it used to be "no preview").
    patchPreview('the-funnel-blueprint', { type: 'pdf' });
    expect((await b.get('/api/v1/courses/the-funnel-blueprint')).json!.data.preview.type).toBe('pdf');
    expect((await b.get('/api/v1/courses/the-funnel-blueprint/preview')).json!.data.type).toBe('pdf');
    patchPreview('podcast-launchpad', { freePreview: false });
    expect((await b.get('/api/v1/courses/podcast-launchpad')).json!.data.preview).toBeNull();
    expect((await b.get('/api/v1/courses/podcast-launchpad')).json!.data.previews).toEqual([]);
    expect((await b.get('/api/v1/courses/podcast-launchpad/preview')).status).toBe(404);
  });

  it('keeps tenants apart and records nothing for guests (playback reports need a session)', async () => {
    expect((await browser('northwind').get('/api/v1/courses/the-funnel-blueprint/preview')).status).toBe(404);
    const guest = browser('amplify');
    await guest.get('/sanctum/csrf-cookie');
    const report = { session: 'b6f1c7e2-6d1f-4c3e-9a51-0f1e2d3c4b5a', segments: [[0, 5]] };
    expect((await guest.post('/api/v1/me/lessons/les_f_0_0/playback', report)).status).toBe(401);
  });
});

describe('learning', () => {
  it('grades quizzes on the server and never sends the answers', async () => {
    const b = browser('amplify');
    await b.signIn();
    const quizId = 'les_e_1_2';
    const lesson = await b.get(`/api/v1/me/lessons/${quizId}`);
    const qs = lesson.json!.data.quiz.questions as { id: string; options: { id: string }[] }[];
    expect(JSON.stringify(lesson.json)).not.toMatch(/"answer"/);
    const wrong = await b.post(`/api/v1/me/lessons/${quizId}/quiz-attempts`, {
      answers: qs.map((q) => ({ question_id: q.id, option_id: q.options[0]!.id })),
    });
    expect(wrong.json!.data.passed).toBe(false);
    const right = await b.post(`/api/v1/me/lessons/${quizId}/quiz-attempts`, {
      answers: qs.map((q, i) => ({ question_id: q.id, option_id: q.options[[1, 2, 1][i]!]!.id })),
    });
    expect(right.json!.data).toMatchObject({ score_percent: 100, passed: true });
    expect((await b.get(`/api/v1/me/lessons/${quizId}`)).json!.data.completed).toBe(true);
  });
  it('issues a certificate when a course reaches 100%', async () => {
    const b = browser('amplify');
    await b.signIn();
    const before = (await b.get('/api/v1/me/certificates')).json!.data.length as number;
    const course = (await b.get('/api/v1/me/courses/email-marketing-mastery')).json!.data;
    const lessons = (course.modules as { lessons: { id: string; type: string; completed: boolean }[] }[]).flatMap((m) => m.lessons);
    for (const l of lessons.filter((x) => !x.completed && x.type !== 'quiz')) await b.post(`/api/v1/me/lessons/${l.id}/complete`);
    for (const l of lessons.filter((x) => x.type === 'quiz')) {
      const qs = (await b.get(`/api/v1/me/lessons/${l.id}`)).json!.data.quiz.questions as { id: string; options: { id: string }[] }[];
      await b.post(`/api/v1/me/lessons/${l.id}/quiz-attempts`, {
        answers: qs.map((q, i) => ({ question_id: q.id, option_id: q.options[[1, 2, 1][i]!]!.id })),
      });
    }
    const certs = (await b.get('/api/v1/me/certificates')).json!.data as { course_slug: string; verify_url: string }[];
    expect(certs.length).toBe(before + 1);
    expect(certs.at(-1)!.verify_url).toMatch(/^https:\/\/amplify\.localhost\/verify\/AC-/);
  });
  it('blocks the player for courses the learner does not own', async () => {
    const b = browser('amplify');
    await b.signIn();
    expect((await b.get('/api/v1/me/courses/podcast-launchpad')).status).toBe(403);
  });
});

describe('lesson player additions (video protection, SCORM, xAPI)', () => {
  it('sends the per-learner watermark with protected videos', async () => {
    const b = browser('amplify');
    await b.signIn();
    const video = (await b.get('/api/v1/me/lessons/les_l_0_0')).json!.data.video;
    expect(video).toMatchObject({ hls_url: null, drm: null, url: null, embed_url: null, captions: [] });
    expect(video.watermark).toMatchObject({ text: 'jordan.tate@gmail.com · jordan', opacity: 0.35, interval_seconds: 20 });
    expect(video.watermark.positions).toHaveLength(5);
    expect(typeof video.watermark.seed).toBe('number');
    expect((await b.get('/api/v1/me/lessons/les_e_0_0')).json!.data.video.watermark).toBeNull();
  });
  it('launches SCORM 1.2 with the LMS-owned data model and completes on a mastered commit', async () => {
    const b = browser('amplify');
    await b.signIn();
    const lesson = (await b.get('/api/v1/me/lessons/les_l_0_1')).json!.data;
    expect(lesson.type).toBe('text');
    expect(lesson.scorm).toMatchObject({ standard: 'SCORM 1.2', state: null });
    expect((await b.post('/api/v1/me/lessons/les_l_0_1/complete')).json!.errors.completion[0]).toMatch(/finish the SCORM activity/);

    const launch = (await b.get('/api/v1/me/lessons/les_l_0_1/scorm')).json!.data;
    expect(launch).toMatchObject({ runtime: 'scorm12', tracking: 'Completion + score' });
    expect(launch.cmi['cmi.core.student_name']).toBe('Tate, Jordan');
    expect(launch.cmi['cmi.core.entry']).toBe('ab-initio');
    expect(launch.cmi['cmi.student_data.mastery_score']).toBe('80');
    // The package's files are served from the school's own origin, framable only by it.
    const file = await app.request(launch.launch_url as string, { headers: { 'X-Tenant': 'amplify' } });
    expect(file.status).toBe(200);
    expect(file.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(await file.text()).toContain('window.parent.API');

    // Element names are data: the commit body is sent as-is (no case conversion).
    const bad = await b.raw('PUT', '/api/v1/me/lessons/les_l_0_1/scorm', JSON.stringify({ cmi: { 'core.lesson_status': 'x' } }));
    expect(bad.status).toBe(422);
    const low = await b.raw(
      'PUT',
      '/api/v1/me/lessons/les_l_0_1/scorm',
      JSON.stringify({ cmi: { 'cmi.core.lesson_status': 'completed', 'cmi.core.score.raw': '40' } }),
    );
    expect(low.json!.data).toMatchObject({ completed: false, state: { success_status: 'failed', completion_status: 'completed' } });
    const done = await b.raw(
      'PUT',
      '/api/v1/me/lessons/les_l_0_1/scorm',
      JSON.stringify({
        cmi: { 'cmi.core.score.raw': '90', 'cmi.core.session_time': '0000:02:30.00', 'cmi.core.student_name': 'Hacker' },
        finish: true,
      }),
    );
    expect(done.json!.data).toMatchObject({ completed: true, state: { success_status: 'passed', total_seconds: 150, completed: true } });
    expect(done.json!.data.progress.completed).toBeGreaterThan(0);
    const again = (await b.get('/api/v1/me/lessons/les_l_0_1/scorm')).json!.data;
    expect(again.cmi['cmi.core.student_name']).toBe('Tate, Jordan');
    expect(again.cmi['cmi.core.entry']).toBe('resume');
    expect((await b.get('/api/v1/me/lessons/les_l_0_1')).json!.data.completed).toBe(true);
  });
  it('runs cmi5 through the LRS: fetch, auth token, then a completed statement completes the lesson', async () => {
    const b = browser('amplify');
    await b.signIn();
    const launch = (await b.get('/api/v1/me/lessons/les_l_1_1/scorm')).json!.data;
    expect(launch).toMatchObject({ runtime: 'cmi5', cmi: null });
    expect((await b.raw('PUT', '/api/v1/me/lessons/les_l_1_1/scorm', JSON.stringify({ cmi: {} }))).status).toBe(422);
    const q = new URL(launch.launch_url as string, 'http://amplify.localhost').searchParams;
    expect(q.get('activityId')).toBe('https://amplifycoaching.com/xapi/pitch-practice');
    // Stateless surface: no session cookie, no CSRF token.
    const fetched = await app.request(new URL(q.get('fetch')!).pathname, { method: 'POST', headers: { 'X-Tenant': 'amplify' } });
    const token = ((await fetched.json()) as { 'auth-token': string })['auth-token'];
    const stmt = await app.request('/api/v1/xapi/statements', {
      method: 'POST',
      headers: { 'X-Tenant': 'amplify', Authorization: `Basic ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ verb: { id: 'http://adlnet.gov/expapi/verbs/completed' }, object: { id: q.get('activityId') } }),
    });
    expect(stmt.status).toBe(200);
    expect(stmt.headers.get('x-experience-api-version')).toBe('1.0.3');
    expect((await b.get('/api/v1/me/lessons/les_l_1_1')).json!.data.completed).toBe(true);
  });
});

describe('quiz review', () => {
  it('holds written answers for review: provisional score, 409 on a new attempt, reviewed feedback', async () => {
    const b = browser('amplify');
    await b.signIn();
    const quiz = (await b.get('/api/v1/me/lessons/les_l_0_2')).json!.data.quiz;
    expect(quiz.last_result).toMatchObject({ review_status: 'reviewed', score_percent: 50, passed: false, pending_points: 0 });
    expect(quiz.last_result.feedback).toMatch(/concrete change/);
    expect((quiz.questions as { type: string }[]).map((x) => x.type)).toEqual(['single_choice', 'multi_select', 'free_text']);
    expect(quiz.questions[0].options[1].id).toBe('o1');
    const [single, multi, free] = quiz.questions as { id: string }[];
    const answers: Record<string, unknown>[] = [
      { question_id: single!.id, option_id: 'o1' },
      { question_id: multi!.id, option_ids: ['o0', 'o2'] },
      { question_id: free!.id, text: '' },
    ];
    expect((await b.post('/api/v1/me/lessons/les_l_0_2/quiz-attempts', { answers })).status).toBe(422);
    answers[2] = { question_id: free!.id, text: 'I will test the headline first.' };
    const r = await b.post('/api/v1/me/lessons/les_l_0_2/quiz-attempts', { answers });
    expect(r.status).toBe(201);
    expect(r.json!.data).toMatchObject({
      review_status: 'pending',
      score_percent: null,
      passed: null,
      provisional_percent: 100,
      pending_points: 2,
      attempt_no: 2,
    });
    const retry = await b.post('/api/v1/me/lessons/les_l_0_2/quiz-attempts', { answers });
    expect(retry.status).toBe(409);
    expect(retry.json!.message).toMatch(/awaiting review/);
    expect((await b.get('/api/v1/me/lessons/les_l_0_2')).json!.data.completed).toBe(false);
  });
});

describe('assignments and peer review', () => {
  it('describes the assignment with the learner deadline, peer progress and file scan states', async () => {
    const b = browser('amplify');
    await b.signIn();
    const landing = (await b.get('/api/v1/me/lessons/les_l_1_2')).json!.data.assignment;
    expect(landing).toMatchObject({
      due_kind: 'weekly',
      due_weekday: 5,
      review_mode: 'peer_instructor',
      can_submit: true,
      submission: null,
    });
    // Rolling: a Friday at 23:59:59 (UTC in the mock), 7 to 13 days after enrolment, plus a week for module 2.
    const due = new Date(landing.due_at as string);
    expect(due.getUTCDay()).toBe(5);
    expect(due.getUTCHours()).toBe(23);
    expect(landing.peer_review).toMatchObject({ required: 2, assigned: 0, completed: 0, next_due_at: null });
    expect(landing.rubric[0]).toEqual({ label: 'Headline hook', hint: 'Leads with the outcome the student wants', max: 5 });

    const pos = (await b.get('/api/v1/me/lessons/les_l_1_3')).json!.data.assignment;
    expect(pos.can_submit).toBe(false);
    expect(pos.submission.grade).toMatchObject({ points: 8, max_points: 10, percent: 80 });
    expect((pos.submission.files as { scan_status: string }[]).map((f) => f.scan_status)).toEqual(['clean', 'infected']);
    expect(pos.submission.peer_feedback).toHaveLength(2);
    expect(JSON.stringify(pos.submission.peer_feedback)).not.toMatch(/Priya|usr_/);
    expect(pos.peer_review).toMatchObject({ required: 2, assigned: 2, completed: 1 });
    const infected = await b.get(`/api/v1/me/submissions/${pos.submission.id}/files/fil_jordan_pos_2`);
    expect(infected.status).toBe(409);
    expect(infected.json).toMatchObject({ code: 'conflict', reason: 'file_quarantined' });
    expect((await b.raw('GET', `/api/v1/me/submissions/${pos.submission.id}/files/fil_jordan_pos_1`, '')).status).toBe(200);
  });
  it('takes a multipart submission, allocates peer reviews and quarantines infected files', async () => {
    const b = browser('amplify');
    await b.signIn();
    const url = '/api/v1/me/lessons/les_l_1_2/submission';
    expect((await b.form(url, new FormData())).json!.errors.text[0]).toBe('Write your answer or attach a file.');
    const wrongType = new FormData();
    wrongType.append('files[]', new File(['x'], 'draft.exe'));
    expect((await b.form(url, wrongType)).json!.errors['files.0'][0]).toBe('Upload one of: PDF, DOCX, PNG, JPG.');

    const form = new FormData();
    form.append('text', 'Headline: launch in 30 days.');
    form.append('files[]', new File(['%PDF'], 'draft.pdf'));
    form.append('files[]', new File(['X5O!P%'], 'eicar-test.pdf'));
    const r = await b.form(url, form);
    expect(r.status).toBe(201);
    expect(r.json!.data).toMatchObject({ status: 'needs_grading', attempt: 1, peer_feedback: [], grade: null });
    expect((r.json!.data.files as { scan_status: string }[]).map((f) => f.scan_status)).toEqual(['clean', 'infected']);

    const lesson = (await b.get('/api/v1/me/lessons/les_l_1_2')).json!.data;
    expect(lesson.completed).toBe(true);
    expect(lesson.assignment.can_submit).toBe(false);
    expect(lesson.assignment.peer_review).toMatchObject({ assigned: 2, completed: 0 });
    expect((await b.form(url, form)).json).toMatchObject({
      code: 'submission_closed',
      message: 'Your submission is waiting to be graded.',
    });

    const bell = (await b.get('/api/v1/me/notifications')).json!.data as { text: string; href: string }[];
    expect(bell[0]!.text).toMatch(/contains malware/);
    expect(bell.some((n) => /ready for your review in .Landing page draft./.test(n.text))).toBe(true);
    expect(bell.every((n) => !('kind' in n))).toBe(true);
  });
  it('lets a reviewer score classmates work anonymously', async () => {
    const b = browser('amplify');
    await b.signIn();
    const list = (await b.get('/api/v1/me/assignments/asg_position/peer-reviews')).json!.data;
    expect((list.assignment.rubric as { id: string }[]).map((c) => c.id)).toEqual(['crit_who', 'crit_why']);
    expect((list.reviews as { status: string }[]).map((r) => r.status)).toEqual(['assigned', 'submitted']);
    const open = list.reviews[0];
    expect(JSON.stringify(open)).not.toMatch(/usr_priya|Priya/);
    const path = `/api/v1/me/assignments/asg_position/peer-reviews/${open.id}`;
    expect((await b.put(path, { scores: [{ criterion_id: 'crit_who', score: 4 }], comment: '' })).json!.errors.scores[0]).toBe(
      'Score every rubric row first.',
    );
    const saved = await b.put(path, {
      scores: [
        { criterion_id: 'crit_who', score: 4 },
        { criterion_id: 'crit_why', score: 3 },
      ],
      comment: 'Clear audience.',
    });
    expect(saved.json!.data).toMatchObject({ status: 'submitted', percent: 70, comment: 'Clear audience.' });
    expect((await b.raw('GET', `${path}/files/${open.work.files[0].id}`, '')).status).toBe(200);
    expect((await b.get('/api/v1/me/assignments/asg_nope/peer-reviews')).status).toBe(404);
    expect((await b.get('/api/v1/me/lessons/les_l_1_3')).json!.data.assignment.peer_review.completed).toBe(2);
  });
});

describe('AI tutor', () => {
  it('answers from the course, flags what it cannot cover and hands off to the team once', async () => {
    const b = browser('amplify');
    await b.signIn();
    expect((await b.get('/api/v1/me/courses/launch-lab/tutor')).json!.data).toEqual({ enabled: true, handoff: true, threads: [] });
    expect((await b.get('/api/v1/me/courses/podcast-launchpad/tutor')).status).toBe(403);
    const covered = await b.post('/api/v1/me/courses/launch-lab/tutor/messages', {
      text: 'How does the funnel simulator work?',
      lesson_id: 'les_l_0_1',
    });
    expect(covered.status).toBe(201);
    expect(covered.json!.data).toMatchObject({ covered: true, can_escalate: true, reply: { role: 'tutor' } });
    const threadId = covered.json!.data.thread.id as string;
    const off = await b.post('/api/v1/me/courses/launch-lab/tutor/messages', { text: 'Can I get a refund?', thread_id: threadId });
    expect(off.json!.data.covered).toBe(false);
    expect(off.json!.data.thread.messages).toHaveLength(4);
    const esc = await b.post(`/api/v1/me/courses/launch-lab/tutor/threads/${threadId}/escalate`, { text: 'Please help' });
    expect(esc.json!.data.status).toBe('escalated');
    const twice = await b.post(`/api/v1/me/courses/launch-lab/tutor/threads/${threadId}/escalate`);
    expect(twice.status).toBe(409);
    expect(twice.json).toMatchObject({ reason: 'already_escalated' });
    expect((await b.post('/api/v1/me/courses/launch-lab/tutor/messages', { text: 'Hello', lesson_id: 'les_f_0_0' })).status).toBe(422);
  });
  it('rests at the school monthly cap (409) and throttles at 30 questions an hour (429)', async () => {
    const b = browser('amplify');
    await b.signIn();
    const t = allTenants().find((x) => x.site.slug === 'amplify')!;
    t.tutor.resting = true;
    const resting = await b.post('/api/v1/me/courses/launch-lab/tutor/messages', { text: 'Hello tutor' });
    expect(resting.status).toBe(409);
    expect(resting.json).toMatchObject({ message: 'The tutor is resting for this month.', reason: 'tutor_resting' });
    t.tutor.resting = false;
    for (let i = 0; i < 29; i++) await b.post('/api/v1/me/courses/launch-lab/tutor/messages', { text: `Question ${i}` });
    expect((await b.post('/api/v1/me/courses/launch-lab/tutor/messages', { text: 'One more' })).status).toBe(429);
  });
  it('is hidden when the school has no tutor', async () => {
    allTenants().find((x) => x.site.slug === 'amplify')!.tutor.enabled = false;
    const b = browser('amplify');
    await b.signIn();
    expect((await b.get('/api/v1/me/courses/launch-lab/tutor')).json!.data).toEqual({ enabled: false, handoff: false, threads: [] });
    expect((await b.post('/api/v1/me/courses/launch-lab/tutor/messages', { text: 'Hi there' })).status).toBe(404);
  });
});

describe('lesson questions, certificates, sign-in, checkout', () => {
  it('appends lesson questions to the thread (oldest first) and caps them at 2,000 characters', async () => {
    const b = browser('amplify');
    await b.signIn();
    expect((await b.post('/api/v1/me/lessons/les_e_1_1/questions', { body: 'x'.repeat(2001) })).status).toBe(422);
    const q = await b.post('/api/v1/me/lessons/les_e_1_1/questions', { body: 'Does this work for B2B?' });
    expect(q.status).toBe(201);
    const thread = (await b.get('/api/v1/me/lessons/les_e_1_1')).json!.data.questions as { id: string }[];
    expect(thread.at(-1)!.id).toBe(q.json!.data.id);
  });
  it('offers the Open Badges credential when published', async () => {
    const b = browser('amplify');
    await b.signIn();
    const certs = (await b.get('/api/v1/me/certificates')).json!.data as Record<string, string | null>[];
    const badge = certs.find((c) => c.id === 'AC-2026-0341')!;
    expect(badge.credential_url).toBe('/api/v1/me/certificates/AC-2026-0341/credential');
    expect(badge.credential_public_url).toMatch(/\/certificates\/AC-2026-0341\/credential$/);
    expect(certs.find((c) => c.id === 'AC-2026-0342')!.credential_url).toBeNull();
    const jwt = await b.raw('GET', '/api/v1/me/certificates/AC-2026-0341/credential', '');
    expect(jwt.status).toBe(200);
    expect(jwt.headers.get('content-type')).toBe('application/vc+jwt');
    expect(jwt.headers.get('content-disposition')).toMatch(/certificate-AC-2026-0341\.jwt/);
    expect((await b.get('/api/v1/me/certificates/AC-2026-0342/credential')).status).toBe(404);
  });
  it('sends failed social sign-ins back with a reason, and runs SAML sign-in only where it is on', async () => {
    const h = { 'X-Tenant': 'amplify' };
    const off = await app.request('/api/v1/auth/oauth/github/redirect?next=/learning', { headers: h });
    expect(off.status).toBe(302);
    expect(off.headers.get('location')).toBe('/sign-in?error=oauth&reason=not_configured&next=%2Flearning');
    const ok = await app.request('/api/v1/auth/oauth/google/redirect?next=//evil.example', { headers: h });
    expect(ok.headers.get('location')).toBe('/learning');
    const saml = await app.request('/api/v1/auth/saml/login?next=/certificates', { headers: h });
    expect(saml.status).toBe(302);
    expect(saml.headers.get('location')).toBe('/certificates');
    expect(saml.headers.getSetCookie().join(';')).toMatch(/coursiva_session=/);
    const failed = await app.request('/api/v1/auth/saml/login?mock_error=expired', { headers: h });
    expect(failed.headers.get('location')).toBe('/sign-in?sso_error=expired');
    expect((await app.request('/api/v1/auth/saml/login', { headers: { 'X-Tenant': 'northwind' } })).status).toBe(404);
  });
  it('signs a SAML session out of the IdP too (single logout), and a password session locally', async () => {
    const b = browser('amplify');
    await b.get('/sanctum/csrf-cookie');
    expect((await b.get('/api/v1/auth/saml/login?next=/learning')).status).toBe(302);
    const out = await b.post('/api/v1/auth/logout');
    expect(out.status).toBe(200);
    expect(out.json!.data.redirect_url).toMatch(/^https?:\/\/[^/]+\/api\/v1\/auth\/saml\/slo\?SAMLRequest=/);
    expect((await b.get('/api/v1/me')).status).toBe(401);
    const slo = await app.request('/api/v1/auth/saml/slo?SAMLResponse=mock', { headers: { 'X-Tenant': 'amplify' } });
    expect(slo.headers.get('location')).toBe('/sign-in');
    const refused = await app.request('/api/v1/auth/saml/slo?mock_error=logout_incomplete', { headers: { 'X-Tenant': 'amplify' } });
    expect(refused.headers.get('location')).toBe('/sign-in?sso_error=logout_incomplete');

    const p = browser('amplify');
    await p.signIn();
    expect((await p.post('/api/v1/auth/logout')).status).toBe(204);
  });
  it('refuses card checkout while the school cannot take payments (422 payment_method)', async () => {
    allTenants().find((x) => x.site.slug === 'amplify')!.chargesBlocked = true;
    const b = browser('amplify');
    await b.signIn();
    const r = await b.post('/api/v1/checkout', {
      target: { kind: 'course', course_slug: 'client-acquisition-sprint' },
      plan: 'full',
      seats: 1,
      country: 'United States',
      name: 'Jordan Tate',
      email: 'jordan.tate@gmail.com',
      payment_method: 'card',
      payment_token: 'tok_visa',
      accept_terms: true,
    });
    expect(r.status).toBe(422);
    expect(r.json!.errors.payment_method[0]).toMatch(/^This school can.t take card payments yet\. Please try again later\.$/);
  });
});

describe('Discord link', () => {
  it('reports the link state, links through the round trip back to next, and unlinks with 204', async () => {
    const b = browser('amplify');
    expect((await b.get('/api/v1/me/discord')).status).toBe(401);
    await b.signIn();
    expect((await b.get('/api/v1/me/discord')).json!.data).toEqual({
      available: true,
      linked: false,
      username: null,
      linked_at: null,
      needs_relink: false,
    });
    const link = await b.raw('GET', '/api/v1/me/discord/link?next=%2Fes%2Faccount', '');
    expect(link.status).toBe(302);
    expect(link.headers.get('location')).toBe('/es/account?discord=linked');
    const linked = (await b.get('/api/v1/me/discord')).json!.data as Record<string, unknown>;
    expect(linked).toMatchObject({ available: true, linked: true, username: 'jordan.tate', needs_relink: false });
    expect(linked.linked_at).toEqual(expect.any(String));
    const del = await b.del('/api/v1/me/discord');
    expect(del.status).toBe(204);
    expect(del.json).toBeNull();
    expect((await b.get('/api/v1/me/discord')).json!.data).toMatchObject({ linked: false, username: null });
    expect((await b.del('/api/v1/me/discord')).status).toBe(204);
  });
  it('sends failures back to a same-site next with a reason, and flags links Discord stopped accepting', async () => {
    const b = browser('amplify');
    await b.signIn();
    const denied = await b.raw('GET', '/api/v1/me/discord/link?next=/account&mock_reason=denied', '');
    expect(denied.headers.get('location')).toBe('/account?discord=error&reason=denied');
    const offsite = await b.raw('GET', '/api/v1/me/discord/link?next=//evil.example', '');
    expect(offsite.headers.get('location')).toBe('/account?discord=linked');
    const t = allTenants().find((x) => x.site.slug === 'amplify')!;
    t.discordLinks[0]!.status = 'needs_relink';
    expect((await b.get('/api/v1/me/discord')).json!.data).toMatchObject({ linked: true, needs_relink: true });
    t.discord.available = false;
    expect((await b.get('/api/v1/me/discord')).json!.data).toMatchObject({ available: false });
    const off = await b.raw('GET', '/api/v1/me/discord/link?next=/account', '');
    expect(off.headers.get('location')).toBe('/account?discord=error&reason=not_available');
  });
  it('is not available on a school without Discord', async () => {
    const b = browser('northwind');
    await b.get('/sanctum/csrf-cookie');
    expect((await b.post('/api/v1/auth/register', { name: 'Sam Lee', email: 'sam@example.com', password: 'password1' })).status).toBe(201);
    expect((await b.get('/api/v1/me/discord')).json!.data).toEqual({
      available: false,
      linked: false,
      username: null,
      linked_at: null,
      needs_relink: false,
    });
    const link = await b.raw('GET', '/api/v1/me/discord/link', '');
    expect(link.headers.get('location')).toBe('/account?discord=error&reason=not_available');
  });
});

describe('phase 17: payments, e-mailed links and storefront pages', () => {
  const buy = {
    target: { kind: 'course', course_slug: 'client-acquisition-sprint' },
    plan: 'full',
    seats: 1,
    country: 'United States',
    name: 'Jordan Tate',
    email: 'jordan.tate@gmail.com',
    payment_method: 'card',
    accept_terms: true,
  };

  it('tells the site how to collect payment details (test cards with the fake gateway)', async () => {
    const b = browser('amplify');
    await b.get('/sanctum/csrf-cookie');
    const q = (await b.post('/api/v1/checkout/quote', { target: buy.target, plan: 'full', seats: 1, country: 'United States' })).json!.data;
    expect(q.payment).toEqual({
      provider: 'test',
      publishable_key: null,
      stripe_account: null,
      methods: ['card', 'paypal', 'bnpl', 'wallet'],
    });
  });
  it('answers next_action for 3-D Secure; the order completes once the processor confirms it', async () => {
    const b = browser('amplify');
    await b.signIn();
    const res = await b.post('/api/v1/checkout', { ...buy, payment_token: 'tok_threeDSecure' });
    expect(res.status).toBe(201);
    expect(res.json!.data.status).toBe('pending');
    expect(res.json!.data.next_action.client_secret).toMatch(/^pi_mock_secret_/);
    expect((await b.get(`/api/v1/orders/${res.json!.data.id}`)).json!.data.status).toBe('paid');
    const paid = await b.post('/api/v1/checkout', {
      ...buy,
      target: { kind: 'course', course_slug: 'podcast-launchpad' },
      payment_token: 'tok_visa',
    });
    expect(paid.json!.data.next_action).toBeNull();
  });
  it('enrols in a free course without checkout; paid courses answer 402', async () => {
    const b = browser('northwind');
    await b.get('/sanctum/csrf-cookie');
    await b.post('/api/v1/auth/register', { name: 'Nia Park', email: 'nia@example.com', password: 'password-123' });
    const free = await b.post('/api/v1/me/enrollments', { course_slug: 'breathwork-for-stress' });
    expect(free.status).toBe(201);
    expect(free.json!.data.course_slug).toBe('breathwork-for-stress');
    expect((await b.post('/api/v1/me/enrollments', { course_slug: 'yoga-foundations' })).status).toBe(402);
  });
  it('redeems a gift link once (`/claim?token=`)', async () => {
    const buyer = browser('amplify');
    await buyer.signIn();
    const order = await buyer.post('/api/v1/checkout', {
      ...buy,
      payment_token: 'tok_visa',
      gift: { recipient_email: 'friend@example.com', message: '' },
    });
    const token = new URL(order.json!.data.gift.claim_url as string).searchParams.get('token')!;
    expect(token).toBeTruthy();
    const claimed = await buyer.post('/api/v1/me/claims', { token });
    expect(claimed.json!.data).toEqual({ claimed: true, course_slug: 'client-acquisition-sprint' });
    expect((await buyer.post('/api/v1/me/claims', { token })).json!.errors.token[0]).toBe('This link has already been used.');
    expect((await buyer.post('/api/v1/me/claims', { token: 'nope' })).json!.errors.token[0]).toBe('This link is not valid.');
  });
  it('resets a password and confirms an email from the e-mailed links', async () => {
    const b = browser('amplify');
    await b.get('/sanctum/csrf-cookie');
    const reset = {
      email: 'jordan.tate@gmail.com',
      token: 'reset-valid',
      password: 'new-password-1',
      password_confirmation: 'new-password-1',
    };
    expect((await b.post('/api/v1/auth/reset-password', { ...reset, token: 'old' })).json!.errors.token[0]).toMatch(
      /invalid or has expired/,
    );
    expect((await b.post('/api/v1/auth/reset-password', reset)).json!.data).toEqual({ reset: true });
    expect((await b.signIn('jordan.tate@gmail.com', 'new-password-1')).status).toBe(200);
    expect((await b.post('/api/v1/auth/email/verify', { token: 'verify-valid' })).json!.data).toEqual({ verified: true });
    const stale = await b.post('/api/v1/auth/email/verify', { token: 'stale' });
    expect(stale.status).toBe(410);
    expect(stale.json!.code).toBe('invalid_token');
    expect((await b.post('/api/v1/auth/email/verification-notification')).json!.data).toEqual({ sent: true });
  });
  it('verifies certificates publicly and serves the blog, partner program, surveys and live sessions', async () => {
    const guest = browser('amplify');
    const cert = await guest.get('/api/v1/registry/certificates/AC-2026-0341');
    expect(cert.json!.data).toMatchObject({ code: 'AC-2026-0341', status: 'valid', holder_name: 'Jordan Tate' });
    expect((await guest.get('/api/v1/registry/certificates/AC-2026-9999')).status).toBe(404);

    const posts = await guest.get('/api/v1/blog/posts?per_page=50');
    expect(posts.json!.data[0].slug).toBe('five-headlines-that-sell');
    expect(posts.json!.meta.total).toBe(2);
    expect((await guest.get('/api/v1/blog/posts/five-headlines-that-sell')).json!.data.body).toContain('## Why headlines matter');

    const program = (await guest.get('/api/v1/affiliates/program')).json!.data;
    expect(program.cookie_days).toBe(30);
    // Hosted partner assets come with their public download link.
    expect(program.assets[0]).toMatchObject({ id: 'aas_banner', meta: 'PNG · 240 KB' });
    expect(program.assets[0].url).toMatch(/\/api\/v1\/affiliates\/assets\/aas_banner$/);
    await guest.get('/sanctum/csrf-cookie');
    expect((await guest.post('/api/v1/affiliates/applications', { name: 'Sam', email: 'sam@example.com', pitch: '' })).status).toBe(201);
    // A partner click answers its id with the program's window and rule (Laravel Referrals::click); unknown → 404.
    const click = await guest.post('/api/v1/affiliates/maya/clicks');
    expect(click.status).toBe(201);
    expect(click.json!.data).toEqual({ click_id: expect.stringMatching(/^afc_/), cookie_days: 30, attribution: 'last_click' });
    expect((await guest.post('/api/v1/affiliates/nobody/clicks')).status).toBe(404);
    expect(program).toMatchObject({ commission_type: 'percent', fixed_amount: null, recurring_months: 12 });
    const fixed = browser('northwind');
    expect((await fixed.get('/api/v1/affiliates/program')).json!.data).toMatchObject({
      rate: 0,
      commission_type: 'fixed',
      fixed_amount: { amount: 1500 },
      tiers: null,
      cookie_days: 0,
      recurring: true,
      recurring_months: 0,
    });
    await fixed.get('/sanctum/csrf-cookie');
    expect((await fixed.post('/api/v1/affiliates/maya/clicks')).json!.data).toMatchObject({ cookie_days: 0, attribution: 'first_click' });

    // SMS short links redirect untouched; unknown codes are a 404 page.
    const link = await guest.raw('GET', '/api/v1/l/Sms0Demo1', '');
    expect(link.status).toBe(302);
    expect(link.headers.get('location')).toBe('https://example.com/spring-sale');
    expect(link.headers.get('cache-control')).toBe('no-store');
    expect((await guest.raw('GET', '/api/v1/l/Unknown12', '')).status).toBe(404);

    const b = browser('amplify');
    await b.signIn();
    expect((await b.get('/api/v1/me/surveys/sr_demo')).json!.data).toEqual({
      id: 'sr_demo',
      question: 'What should we teach next?',
      answered: false,
    });
    expect((await b.post('/api/v1/me/surveys/sr_demo/answers', { score: 9, text: 'Pricing' })).status).toBe(201);
    expect((await b.post('/api/v1/me/surveys/sr_demo/answers', { score: 9, text: 'Again' })).status).toBe(409);
    const room = (await b.get('/api/v1/me/live/evt_room')).json!.data;
    expect(room).toMatchObject({ status: 'live', provider: 'built_in', going: true });
    expect(room.polls[0].options).toEqual(['Pricing', 'Launch emails']);
    expect((await b.post('/api/v1/me/live/evt_room/presence')).status).toBe(204);
    expect((await b.post('/api/v1/me/live/evt_1/presence')).status).toBe(409);
    // The room's video: a short-lived Daily meeting token (Laravel `POST /me/live/{id}/token`).
    expect((await b.post('/api/v1/me/live/evt_room/token')).json!.data).toMatchObject({
      room_url: 'https://mock.daily.co/cv-evt_room',
      token: 'mock-daily-token-evt_room',
      is_owner: false,
      can_record: false,
    });
    expect((await b.post('/api/v1/me/live/evt_1/token')).status).toBe(409);
    // The room's server state (Laravel `GET /me/live/{id}/room`): host moderation reaches the learner.
    const hook = (action: Record<string, unknown>) =>
      app.request('/__mock/live/amplify/evt_room', {
        method: 'POST',
        body: JSON.stringify(action),
        headers: { 'Content-Type': 'application/json' },
      });
    expect((await b.post('/api/v1/me/live/evt_room/chat', { message: 'Hello room' })).status).toBe(204);
    type Feed = { chat: { message: string; mine: boolean; kind: string }[] };
    let feed = (await b.get('/api/v1/me/live/evt_room/room')).json!.data as Feed;
    expect(feed.chat.at(-1)).toMatchObject({ message: 'Hello room', mine: true, kind: 'message' });
    expect((await hook({ action: 'hide', text: 'Hello room' })).status).toBe(204);
    feed = (await b.get('/api/v1/me/live/evt_room/room')).json!.data as Feed;
    expect(feed.chat.map((m) => m.message)).not.toContain('Hello room');
    // Slow mode counts from the learner's last message ("Hello room", just now), like Laravel's last_chat_at.
    await hook({ action: 'slow', seconds: 30 });
    const slow = await b.post('/api/v1/me/live/evt_room/chat', { message: 'one' });
    expect(slow.status).toBe(429);
    expect(slow.json).toMatchObject({ reason: 'slow_mode' });
    expect(Number(slow.json!.retry_after)).toBeGreaterThan(0);
    await hook({ action: 'slow', seconds: 0 });
    expect((await b.post('/api/v1/me/live/evt_room/chat', { message: 'two' })).status).toBe(204);
    await hook({ action: 'lock', on: true });
    expect((await b.post('/api/v1/me/live/evt_room/chat', { message: 'three' })).json).toMatchObject({ reason: 'chat_locked' });
    expect((await b.post('/api/v1/me/live/evt_room/polls/poll_1/votes', { option: 1 })).status).toBe(204);
    expect((await b.post('/api/v1/me/live/evt_room/polls/poll_1/votes', { option: 0 })).status).toBe(409);
    expect((await b.get('/api/v1/me/live/evt_room/room')).json!.data.polls[0]).toMatchObject({ my_vote: 1, total_votes: 4 });
    expect((await b.post('/api/v1/me/live/evt_room/stage/accept')).status).toBe(409);
    await hook({ action: 'remove', email: 'jordan.tate@gmail.com' });
    const gone = await b.get('/api/v1/me/live/evt_room/room');
    expect(gone.status).toBe(403);
    expect(gone.json).toMatchObject({ reason: 'removed' });
    expect((await b.post('/api/v1/me/live/evt_room/token')).status).toBe(403);
    // Nothing on file: a message, not a redirect (the site shows it in place).
    const fresh = browser('amplify');
    await fresh.get('/sanctum/csrf-cookie');
    await fresh.post('/api/v1/auth/register', { name: 'New Learner', email: 'new.learner@example.com', password: 'password-123' });
    expect((await fresh.get('/api/v1/me/billing-portal?return=/account')).status).toBe(409);
  });
  it('lists purchased files and hands out counted, signed download links', async () => {
    const b = browser('amplify');
    await b.signIn();
    const [d] = (await b.get('/api/v1/me/downloads')).json!.data as { order_id: string; product_id: string; downloads_left: number }[];
    expect(d).toMatchObject({ order_id: 'ord_seed_dl', product_id: 'prd_checklist', downloads_left: 3, available: true });
    const path = `/api/v1/me/downloads/${d!.order_id}/${d!.product_id}/link`;
    for (let i = 0; i < 3; i++) expect((await b.post(path)).json!.data.url).toContain('launch-checklist.pdf');
    const spent = await b.post(path);
    expect(spent.status).toBe(409);
    expect(spent.json!.reason).toBe('download_limit');
    expect((await b.post('/api/v1/me/downloads/ord_x/prd_checklist/link')).status).toBe(404);
  });
  it('sells a single digital download from its product page through the checkout', async () => {
    const guest = browser('amplify');
    const page = (await guest.get('/api/v1/products/launch-kit')).json!.data;
    expect(page).toMatchObject({
      slug: 'launch-kit',
      kind: 'download',
      price: { amount: 1900 },
      file: { name: 'launch-kit.zip' },
      courses: [],
    });
    expect((await guest.get('/api/v1/products/funnel-email-bundle')).json!.data).toMatchObject({ kind: 'bundle', file: null });
    expect((await guest.get('/api/v1/products/nope')).status).toBe(404);

    const target = { kind: 'product', product_slug: 'launch-kit' };
    await guest.get('/sanctum/csrf-cookie');
    const quote = (await guest.post('/api/v1/checkout/quote', { target, seats: 4 })).json!.data;
    expect(quote.lines).toEqual([expect.objectContaining({ title: 'Launch kit', quantity: 1 })]);
    expect(quote.installment_option).toBeNull();
    expect((await guest.post('/api/v1/checkout/quote', { target: { kind: 'product', product_slug: 'nope' } })).status).toBe(422);

    const b = browser('amplify');
    await b.signIn();
    const input = {
      target,
      plan: 'full',
      seats: 1,
      country: 'United States',
      name: 'Jordan Tate',
      email: 'jordan.tate@gmail.com',
      accept_terms: true,
      payment_method: 'card',
      payment_token: 'tok_visa',
    };
    const gift = await b.post('/api/v1/checkout', { ...input, gift: { recipient_email: 'friend@example.com', message: '' } });
    expect(gift.status).toBe(422);
    expect(gift.json!.errors.target[0]).toBe('Digital downloads can’t be sent as a gift.');
    const order = (await b.post('/api/v1/checkout', { ...input, gift: null })).json!.data;
    expect(order).toMatchObject({ status: 'paid', start_lesson: null });
    expect(order.items[0]).toMatchObject({ kind: 'product', meta: 'Digital download' });
    const [d] = (await b.get('/api/v1/me/downloads')).json!.data as { order_id: string; product_id: string }[];
    expect(d).toMatchObject({ order_id: order.id, product_id: 'prd_launch_kit' });
    expect((await b.post(`/api/v1/me/downloads/${order.id}/prd_launch_kit/link`)).json!.data.url).toContain('launch-kit.zip');
  });
});

describe('order history, invoices and billing (docs/api/commerce.md → orders, account.md → billing)', () => {
  it('pages the learner’s orders newest first, with refunds, invoices and the seller block', async () => {
    const b = browser('amplify');
    await b.signIn();
    const page = (await b.get('/api/v1/me/orders?per_page=2')).json!;
    expect(page.meta).toMatchObject({ current_page: 1, last_page: 2, per_page: 2, total: 4 });
    expect((page.data as { id: string }[]).map((o) => o.id)).toEqual(['ord_1003', 'ord_1002']);
    expect(page.data[0]).toMatchObject({
      number: 'AMP-2026-1003',
      status: 'paid',
      item_count: 1,
      has_invoice: true,
      refunded: { amount: 0 },
    });
    const last = (await b.get('/api/v1/me/orders?page=2&per_page=2')).json!.data as {
      id: string;
      status: string;
      refunded: { amount: number };
    }[];
    expect(last.at(-1)).toMatchObject({ id: 'ord_1000', status: 'partially_refunded', refunded: { amount: 1000 } });
    expect((await b.get('/api/v1/me/orders?per_page=500')).status).toBe(422);

    const order = (await b.get('/api/v1/me/orders/ord_1000')).json!.data;
    expect(order).toMatchObject({ status: 'partially_refunded', refunded: { amount: 1000 }, paid_at: expect.any(String) });
    expect(order.seller).toEqual({
      name: 'Amplify Coaching',
      legal_name: 'Amplify Coaching',
      email: 'help@amplifycoaching.com',
      address: '12 Market Street\nLondon EC1A 1BB\nUnited Kingdom',
      tax_id: 'GB123456789',
    });
    expect((await b.get('/api/v1/me/orders/ord_nope')).status).toBe(404);

    // Only receipted orders reach the dashboard's purchases (newest first, five at most).
    const purchases = (await b.get('/api/v1/me/dashboard')).json!.data.purchases as { order_id: string }[];
    expect(purchases.map((p) => p.order_id)).toEqual(['ord_1003', 'ord_1002', 'ord_1001', 'ord_1000']);
  });

  it('emails an invoice copy to the learner, three times per ten minutes', async () => {
    const b = browser('amplify');
    await b.signIn();
    const sent = await b.post('/api/v1/me/orders/ord_1001/invoice/email');
    expect(sent.status).toBe(202);
    expect(sent.json!.data).toEqual({ sent: true, email: 'jordan.tate@gmail.com' });
    expect((await b.post('/api/v1/me/orders/ord_nope/invoice/email')).status).toBe(404);
    expect((await b.post('/api/v1/me/orders/ord_1001/invoice/email')).status).toBe(202);
    expect((await b.post('/api/v1/me/orders/ord_1001/invoice/email')).status).toBe(429);
    const guest = browser('amplify');
    expect((await guest.get('/api/v1/me/orders')).status).toBe(401);
  });

  it('shows the card and membership on the profile, and the certificate reminders switch', async () => {
    const b = browser('amplify');
    await b.signIn();
    const profile = (await b.get('/api/v1/me/profile')).json!.data;
    expect(profile.card).toEqual({ brand: 'Visa', last4: '4242', exp_month: 4, exp_year: 2028 });
    expect(profile.preferences).toMatchObject({ certificate_reminders: true });
    const prefs = await b.put('/api/v1/me/preferences', {
      new_lessons: true,
      community_replies: true,
      live_reminders: false,
      certificate_reminders: false,
    });
    expect(prefs.json!.data).toMatchObject({ certificate_reminders: false });
    expect((await b.get('/api/v1/me/profile')).json!.data.preferences.certificate_reminders).toBe(false);
  });
});

describe('instructor profiles (docs/api/instructors.md)', () => {
  const slugs = (rows: unknown) => (rows as { slug: string }[]).map((r) => r.slug);
  it('lists only published profiles of active members, by name, paginated', async () => {
    const guest = browser('amplify');
    const list = await guest.get('/api/v1/instructors');
    expect(list.status).toBe(200);
    expect(slugs(list.json!.data)).toEqual(['maya-reyes', 'priya-shah']);
    expect(list.json!.meta).toMatchObject({ current_page: 1, last_page: 1, per_page: 25, total: 2 });
    expect(Object.keys(list.json!.data[0]).sort()).toEqual([
      'avatar_url',
      'color',
      'expertise',
      'headline',
      'initials',
      'name',
      'slug',
      'stats',
    ]);
    expect((await guest.get('/api/v1/instructors?sort=-name')).json!.data[0].slug).toBe('priya-shah');
    const paged = await guest.get('/api/v1/instructors?per_page=1&page=2');
    expect(slugs(paged.json!.data)).toEqual(['priya-shah']);
    expect(paged.json!.meta).toMatchObject({ current_page: 2, last_page: 2, per_page: 1 });
    // A school without published profiles: an empty page, not a 404.
    const none = await browser('northwind').get('/api/v1/instructors');
    expect(none.status).toBe(200);
    expect(none.json).toMatchObject({ data: [], meta: { total: 0 } });
  });

  it('serves a profile with stats over its published courses; drafts, unknown and former slugs are 404', async () => {
    const guest = browser('amplify');
    const p = (await guest.get('/api/v1/instructors/maya-reyes')).json!.data;
    expect(p).toMatchObject({ slug: 'maya-reyes', name: 'Maya Reyes', initials: 'MR', website: 'https://mayareyes.example.com' });
    expect(p.bio_html).toContain('<h2>How I teach</h2>');
    expect(p.bio_excerpt.length).toBeLessThanOrEqual(280);
    expect(p.bio_excerpt).not.toContain('<');
    expect((p.social_links as { platform: string }[]).map((l) => l.platform)).toEqual(['linkedin', 'x', 'youtube']);
    expect(p.credentials[0]).toEqual({ title: 'Certified Funnel Strategist', issuer: 'Funnel Academy', year: 2019 });
    expect(p.seo).toEqual({
      title: 'Maya Reyes — funnel strategist and course creator',
      description: (p.bio_excerpt as string).slice(0, 160),
      image_url: null,
    });
    // Her courses (not the ones Priya or Leo teach), with the catalogue card shape; figures over exactly those courses.
    const catalog = (await guest.get('/api/v1/courses')).json!.data.courses as {
      slug: string;
      rating: number;
      review_count: number;
      instructor: { slug: string | null };
    }[];
    const hers = catalog.filter((c) => c.instructor.slug === 'maya-reyes');
    expect(slugs(p.courses).sort()).toEqual(hers.map((c) => c.slug).sort());
    expect(slugs(p.courses)).not.toContain('launch-lab');
    const reviews = hers.reduce((n, c) => n + c.review_count, 0);
    expect(p.stats).toEqual({
      learner_count: 1284,
      course_count: hers.length,
      rating: Math.round((hers.reduce((n, c) => n + c.rating * c.review_count, 0) / reviews) * 10) / 10,
      review_count: reviews,
    });

    expect((await guest.get('/api/v1/instructors/leo-park')).status).toBe(404); // a draft
    expect((await guest.get('/api/v1/instructors/nobody')).json).toEqual({ message: 'Instructor not found.' });
    expect((await guest.get('/api/v1/instructors/maya')).status).toBe(404); // a former slug
    expect((await browser('northwind').get('/api/v1/instructors/maya-reyes')).status).toBe(404); // another school's
  });

  it('resolves a renamed profile’s former address to the current one (301), and nothing else', async () => {
    const guest = browser('amplify');
    const r = await guest.get('/api/v1/redirects/resolve?path=/instructors/maya');
    expect(r.json).toEqual({ data: { to: '/instructors/maya-reyes', status: 301 } });
    expect((await guest.get('/api/v1/redirects/resolve?path=/instructors/nobody')).status).toBe(404);
    expect((await guest.get('/api/v1/redirects/resolve?path=/courses/maya')).status).toBe(404);
  });

  it('links course instructors to visible profiles only and fills the course page’s instructor block from them', async () => {
    const guest = browser('amplify');
    const funnel = (await guest.get('/api/v1/courses/the-funnel-blueprint')).json!.data;
    const maya = (await guest.get('/api/v1/instructors/maya-reyes')).json!.data;
    expect(funnel.instructor).toEqual({ name: 'Maya Reyes', initials: 'MR', avatar_url: null, color: maya.color, slug: 'maya-reyes' });
    expect(funnel.instructor_profile).toEqual({
      role: 'Instructor',
      bio: maya.bio_excerpt,
      student_count: maya.stats.learner_count,
      slug: 'maya-reyes',
      headline: maya.headline,
      course_count: maya.stats.course_count,
      rating: maya.stats.rating,
      review_count: maya.stats.review_count,
    });
    // An unpublished profile: the member's name, no photo, no link, no figures.
    const launch = (await guest.get('/api/v1/courses/launch-lab')).json!.data;
    expect(launch.instructor).toMatchObject({ name: 'Leo Park', avatar_url: null, slug: null });
    expect(launch.instructor_profile).toEqual({
      role: 'Instructor',
      bio: '',
      student_count: 0,
      slug: null,
      headline: '',
      course_count: 0,
      rating: null,
      review_count: 0,
    });
    const northwind = (await browser('northwind').get('/api/v1/courses')).json!.data.courses;
    expect(northwind[0].instructor.slug).toBeNull();
  });

  it('honours the site lock like the catalogue', async () => {
    const locked = browser('hideout');
    expect((await locked.get('/api/v1/instructors')).json).toMatchObject({ code: 'site_locked' });
    expect((await locked.get('/api/v1/instructors/anyone')).status).toBe(401);
  });
});

describe('interactive lesson blocks (course builder v2 O3)', () => {
  const LESSON = '/api/v1/me/lessons/les_f_0_0';
  const blk = (n: number) => `blk_demo0000000000${String(n).padStart(2, '0')}`;
  const at = (n: number, action: string) => `${LESSON}/blocks/${blk(n)}/${action}`;
  const learner = async (email?: string) => {
    const b = browser('amplify');
    await b.signIn(email);
    return b;
  };
  type Wire = Record<string, any>;
  const find = (blocks: Wire[], n: number) => blocks.find((x) => x.id === blk(n))!;
  const lessonOf = (res: { json: Wire | null }) => res.json!.data as { blocks: Wire[]; blocks_locked: number };
  /** Keys that would leak grading data before an answer. */
  const SECRET_KEY = /"(correct|answers|feedback|feedback_correct|feedback_incorrect|category_id|correct_option_ids)"\s*:/;

  it('sends no answers, categories or feedback, and nothing after the first unpassed gate', async () => {
    const b = await learner();
    const res = await b.raw('GET', LESSON, '');
    const lesson = lessonOf(res);
    expect(SECRET_KEY.test(JSON.stringify(lesson.blocks))).toBe(false);
    expect(res.text).not.toContain('Right — the landing page converts.');
    expect(res.text).not.toContain('Hint: they land on it.');
    expect(lesson.blocks_locked).toBe(4);
    expect(lesson.blocks.at(-1)).toEqual({ id: blk(20), type: 'continue', label: 'Continue', passed: false });
    expect(lesson.blocks.map((x) => x.id as string)).not.toContain(blk(21));
    expect(find(lesson.blocks, 18)).toEqual({
      id: blk(18),
      type: 'check',
      kind: 'single',
      question_html: '<p>Which stage turns visitors into <strong>leads</strong>?</p>',
      options: [
        { id: 'a', text: 'Attract' },
        { id: 'b', text: 'Convert' },
        { id: 'c', text: 'Nurture' },
      ],
      required: true,
      state: null,
    });
    const sorting = find(lesson.blocks, 19);
    expect(Object.keys(sorting).sort()).toEqual(['categories', 'id', 'items', 'prompt', 'state', 'type']);
    expect((sorting.items as object[]).every((i) => Object.keys(i).join() === 'id,text')).toBe(true);
    // A stable order per learner.
    expect(find((await b.get(LESSON)).json!.data.blocks, 19).items).toEqual(sorting.items);
  });

  it('grades a check server-side, stores the latest answer and reveals it only afterwards', async () => {
    const b = await learner();
    expect((await b.post(at(18, 'check'), { option_ids: ['a', 'b'] })).status).toBe(422);
    expect((await b.post(at(18, 'check'), { option_ids: ['z'] })).status).toBe(422);
    expect((await b.post(at(18, 'check'), {})).status).toBe(422);
    const wrong = await b.post(at(18, 'check'), { option_ids: ['a'] });
    expect(wrong).toEqual({
      status: 200,
      json: { data: { correct: false, correct_option_ids: ['b'], feedback: 'Not quite: converting is where a visitor becomes a lead.' } },
    });
    const right = await b.post(at(18, 'check'), { option_ids: ['b'] });
    expect(right.json!.data).toEqual({ correct: true, correct_option_ids: ['b'], feedback: 'Right — the landing page converts.' });
    expect(find((await b.get(LESSON)).json!.data.blocks, 18).state).toEqual({
      answer: { option_ids: ['b'] },
      correct: true,
      correct_option_ids: ['b'],
      feedback: 'Right — the landing page converts.',
    });
    // Not a check, unknown, or behind the gate: 404.
    expect((await b.post(at(1, 'check'), { option_ids: ['a'] })).status).toBe(404);
    expect((await b.post(`${LESSON}/blocks/blk_nope/check`, { option_ids: ['a'] })).status).toBe(404);
    expect((await b.post(at(21, 'check'), { option_ids: ['a'] })).status).toBe(404);
    // Signed out: 401.
    const guest = browser('amplify');
    await guest.get('/sanctum/csrf-cookie');
    expect((await guest.post(at(18, 'check'), { option_ids: ['b'] })).status).toBe(401);
  });

  it('grades sorting per item and needs every item placed', async () => {
    const b = await learner();
    expect((await b.post(at(19, 'sort'), { placements: { ads: 'attract' } })).status).toBe(422);
    const badCategory = { ads: 'attract', seo: 'attract', form: 'convert', magnet: 'nope' };
    expect((await b.post(at(19, 'sort'), { placements: badCategory })).status).toBe(422);
    const res = await b.post(at(19, 'sort'), { placements: { ads: 'attract', seo: 'convert', form: 'convert', magnet: 'convert' } });
    expect(res.json!.data).toEqual({ correct: false, results: { ads: true, seo: false, form: true, magnet: true } });
    expect(find((await b.get(LESSON)).json!.data.blocks, 19).state).toEqual({
      correct: false,
      results: { ads: true, seo: false, form: true, magnet: true },
      answer: { placements: { ads: 'attract', seo: 'convert', form: 'convert', magnet: 'convert' } },
    });
    const right = { ads: 'attract', seo: 'attract', form: 'convert', magnet: 'convert' };
    expect((await b.post(at(19, 'sort'), { placements: right })).json!.data.correct).toBe(true);
  });

  it('opens the next section once the required checks above a gate are answered', async () => {
    const b = await learner();
    expect(await b.post(at(20, 'continue'))).toEqual({
      status: 422,
      json: {
        message: 'Answer the questions above first.',
        code: 'validation_failed',
        errors: { required: ['Answer the questions above first.'] },
      },
    });
    await b.post(at(18, 'check'), { option_ids: ['c'] }); // a wrong answer still counts as answered
    expect((await b.post(at(20, 'continue'))).json!.data).toEqual({ passed: true });
    expect((await b.post(at(20, 'continue'))).json!.data).toEqual({ passed: true }); // idempotent

    let lesson = lessonOf(await b.get(LESSON));
    expect(lesson.blocks_locked).toBe(1);
    expect(lesson.blocks.map((x) => x.id as string).slice(-4)).toEqual([blk(20), blk(21), blk(22), blk(23)]);
    expect(find(lesson.blocks, 20).passed).toBe(true);
    expect(SECRET_KEY.test(JSON.stringify(lesson.blocks.slice(-3)))).toBe(false);

    expect((await b.post(at(23, 'continue'))).status).toBe(422);
    // Fill answers match trimmed, case-insensitive, inner whitespace collapsed; fill has no correct options.
    expect((await b.post(at(22, 'check'), { text: '  LANDING ' })).json!.data).toEqual({
      correct: true,
      correct_option_ids: [],
      feedback: null,
    });
    expect((await b.post(at(23, 'continue'))).status).toBe(200);
    lesson = lessonOf(await b.get(LESSON));
    expect(lesson.blocks_locked).toBe(0);
    expect(lesson.blocks).toHaveLength(24);

    // The guest preview still stops at the first gate (a session is ignored).
    const preview = lessonOf(await b.get('/api/v1/courses/the-funnel-blueprint/preview'));
    expect(preview.blocks.at(-1)).toMatchObject({ id: blk(20), type: 'continue', passed: false });
    expect(preview.blocks_locked).toBe(4);
    expect(find(preview.blocks, 18).state).toBeNull();
  });

  it('keeps each learner’s answers and gates to themselves', async () => {
    const a = await learner();
    await a.post(at(18, 'check'), { option_ids: ['b'] });
    expect((await a.post(at(20, 'continue'))).status).toBe(200);
    const other = await learner('priya.nair@example.com');
    const lesson = lessonOf(await other.get(LESSON));
    expect(lesson.blocks_locked).toBe(4);
    expect(find(lesson.blocks, 18).state).toBeNull();
    expect((await other.post(at(21, 'check'), { option_ids: ['a'] })).status).toBe(404);
  });
});

describe('availability, completion rules and live lessons (course builder v2 O4)', () => {
  const outline = async (b: ReturnType<typeof browser>) =>
    (
      (await b.get('/api/v1/me/courses/launch-lab')).json!.data.modules as {
        lessons: { id: string; locked: boolean; lock_reason: string | null; unlocks_at: string | null; after: unknown }[];
      }[]
    ).flatMap((m) => m.lessons);

  it('locks lessons by days after enrolment, by date and until another lesson is done', async () => {
    const b = browser('amplify');
    await b.signIn();
    const lessons = await outline(b);
    const byId = (id: string) => lessons.find((l) => l.id === id)!;
    expect(byId('les_l_0_0')).toMatchObject({ locked: false, lock_reason: null, unlocks_at: null, after: null });
    // Enrolled 10 days ago, opens 14 days after the start of the enrolment day.
    expect(byId('les_l_2_5')).toMatchObject({ locked: true, lock_reason: 'drip' });
    const opens = new Date(byId('les_l_2_5').unlocks_at!).getTime();
    expect(opens - Date.now()).toBeGreaterThan(3 * 86_400_000);
    expect(opens - Date.now()).toBeLessThan(5 * 86_400_000);
    expect(byId('les_l_2_6')).toMatchObject({ locked: true, lock_reason: 'date' });
    expect(byId('les_l_2_7')).toMatchObject({
      locked: true,
      lock_reason: 'after_item',
      unlocks_at: null,
      after: { id: 'les_l_2_1', title: 'Launch-day checklist' },
    });

    // The lesson endpoint refuses with the same lock.
    const refused = await b.get('/api/v1/me/lessons/les_l_2_7');
    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({
      code: 'lesson_locked',
      reason: 'after_item',
      unlocks_at: null,
      after: { id: 'les_l_2_1', title: 'Launch-day checklist' },
    });
    expect((await b.get('/api/v1/me/lessons/les_l_2_6')).json).toMatchObject({ reason: 'date', unlocks_at: byId('les_l_2_6').unlocks_at });
  });

  it('completes a time-rule lesson from heartbeats (validated, throttled) and then opens the lesson after it', async () => {
    const b = browser('amplify');
    await b.signIn();
    const lesson = (await b.get('/api/v1/me/lessons/les_l_2_1')).json!.data;
    expect(lesson.completion).toEqual({ rule: 'time', value: 10, progress: 0, done: false });
    const complete = await b.post('/api/v1/me/lessons/les_l_2_1/complete');
    expect(complete.status).toBe(422);
    expect(complete.json!.errors.completion[0]).toBe('This lesson completes on its own when you’ve spent 10 minutes on it.');
    expect((await b.del('/api/v1/me/lessons/les_l_2_1/complete')).status).toBe(422);
    for (const seconds of [0, 61, 1.5, 'x']) expect((await b.post('/api/v1/me/lessons/les_l_2_1/time', { seconds })).status).toBe(422);
    const beat = await b.post('/api/v1/me/lessons/les_l_2_1/time', { seconds: 60 });
    expect(beat.json!.data).toEqual({ time_spent_sec: 60, completed: false });
    expect((await b.get('/api/v1/me/lessons/les_l_2_1')).json!.data.completion).toMatchObject({ progress: 10, done: false });
    for (let i = 0; i < 5; i++) await b.post('/api/v1/me/lessons/les_l_2_1/time', { seconds: 60 });
    expect((await b.post('/api/v1/me/lessons/les_l_2_1/time', { seconds: 60 })).status).toBe(429);
    // Past the throttle window, the remaining beats complete the lesson.
    const t = allTenants().find((x) => x.site.slug === 'amplify')!;
    t.lessonTime!.find((r) => r.lessonId === 'les_l_2_1')!.beats = [];
    for (let i = 0; i < 3; i++) await b.post('/api/v1/me/lessons/les_l_2_1/time', { seconds: 60 });
    const last = await b.post('/api/v1/me/lessons/les_l_2_1/time', { seconds: 60 });
    expect(last.json!.data).toEqual({ time_spent_sec: 600, completed: true });
    expect((await b.get('/api/v1/me/lessons/les_l_2_1')).json!.data.completion).toEqual({
      rule: 'time',
      value: 10,
      progress: 100,
      done: true,
    });
    expect((await b.get('/api/v1/me/lessons/les_l_2_7')).status).toBe(200);
  });

  it('completes a video-rule lesson from the watched share of playback reports', async () => {
    const b = browser('amplify');
    await b.signIn();
    const report = (segments: number[][]) => b.post('/api/v1/me/lessons/les_l_2_0/playback', { session: 'abcdefgh', segments });
    expect((await b.get('/api/v1/me/lessons/les_l_2_0')).json!.data.completion).toEqual({
      rule: 'video',
      value: 80,
      progress: 0,
      done: false,
    });
    // 12:00 video: 0–300 and an overlapping 200–400 cover 400 s (55%).
    await report([[0, 300]]);
    await report([[200, 400]]);
    expect((await b.get('/api/v1/me/lessons/les_l_2_0')).json!.data.completion).toMatchObject({ progress: 55, done: false });
    expect((await report([[400, 600]])).json!.data.completion).toEqual({ rule: 'video', value: 80, progress: 100, done: true });
    expect((await b.get('/api/v1/me/lessons/les_l_2_0')).json!.data).toMatchObject({
      completed: true,
      completion: { progress: 100, done: true },
    });
  });

  it('completes a checks-rule lesson once every knowledge check has an answer', async () => {
    const b = browser('amplify');
    await b.signIn();
    const url = '/api/v1/me/lessons/les_l_2_2';
    expect((await b.get(url)).json!.data.completion).toEqual({ rule: 'checks', value: null, progress: 0, done: false });
    await b.post(`${url}/blocks/blk_plan000000000002/check`, { option_ids: ['a'] });
    expect((await b.get(url)).json!.data.completion).toMatchObject({ progress: 50, done: false });
    await b.post(`${url}/blocks/blk_plan000000000003/check`, { text: 'sales' });
    expect((await b.get(url)).json!.data).toMatchObject({ completed: true, completion: { progress: 100, done: true } });
  });

  it('sends a Live lesson’s session, without a join link until it opens, and its recording once ended', async () => {
    const b = browser('amplify');
    await b.signIn();
    const upcoming = (await b.get('/api/v1/me/lessons/les_l_2_3')).json!.data;
    expect(upcoming.type).toBe('live');
    expect(upcoming.completion).toEqual({ rule: 'live', value: null, progress: null, done: false });
    expect(upcoming.live).toMatchObject({
      session_id: 'lsn_launch_review',
      title: 'Live launch review',
      duration_min: 60,
      provider: 'zoom',
      status: 'scheduled',
      join_url: null,
      recording: null,
    });
    const ended = (await b.get('/api/v1/me/lessons/les_l_2_4')).json!.data.live;
    expect(ended).toMatchObject({ status: 'ended', join_url: null, recording: { embed_url: expect.stringMatching(/^https:\/\//) } });
    expect((await b.post('/api/v1/me/lessons/les_l_2_3/complete')).json!.errors.completion[0]).toMatch(/attend the live session/);
    // Other lessons keep the manual rule and no live block.
    expect((await b.get('/api/v1/me/lessons/les_e_1_1')).json!.data).toMatchObject({
      completion: { rule: 'manual', value: null, progress: null },
      live: null,
    });
  });
});

describe('survey lessons', () => {
  const LESSON = '/api/v1/me/lessons/les_l_2_8';
  const SURVEY = `${LESSON}/survey`;
  const learner = async () => {
    const b = browser('amplify');
    await b.signIn();
    return b;
  };

  it('sends the survey (every field but email), its intro as the body and the survey completion rule', async () => {
    const b = await learner();
    const lesson = (await b.get(LESSON)).json!.data;
    expect(lesson.type).toBe('text');
    expect(lesson.body_html).toMatch(/^<p>Tell us how the lab went/);
    expect(lesson.completion).toEqual({ rule: 'survey', value: null, progress: null, done: false });
    expect(lesson.survey).toMatchObject({
      form_id: 'frm_launch_feedback',
      title: 'Launch Lab feedback',
      allow_resubmit: true,
      can_submit: true,
      response: null,
    });
    expect((lesson.survey.fields as { type: string }[]).map((f) => f.type)).toEqual([
      'rating',
      'long_text',
      'choice',
      'checkbox',
      'number',
    ]);
    expect(lesson.survey.fields[0]).toEqual({
      key: 'rating',
      label: 'How would you rate Launch Lab?',
      required: true,
      type: 'rating',
      options: [],
    });
    expect(lesson.survey.fields[2].options).toEqual(['Too slow', 'Just right', 'Too fast']);
    // Other lessons: no survey.
    expect((await b.get('/api/v1/me/lessons/les_l_2_1')).json!.data.survey).toBeNull();
    // Manual completion is refused: the survey completes it.
    const manual = await b.post(`${LESSON}/complete`);
    expect(manual.status).toBe(422);
    expect(manual.json!.errors.completion[0]).toBe('This lesson completes on its own when you submit the survey.');
  });

  it('validates answers per question (keyed by index) and needs at least one answer', async () => {
    const b = await learner();
    const bad = await b.post(SURVEY, {
      answers: [
        { key: 'rating', value: 7 },
        { key: 'highlight', value: 'x'.repeat(5001) },
        { key: 'pace', value: 'Sideways' },
        { key: 'hours', value: 'many' },
      ],
    });
    expect(bad.status).toBe(422);
    expect(bad.json!.errors).toEqual({
      'answers.0': ['Choose a rating from 1 to 5.'],
      'answers.1': ['This answer must not be longer than 5000 characters.'],
      'answers.2': ['Choose one of the options.'],
      'answers.4': ['Enter a number.'],
    });
    const missing = await b.post(SURVEY, { answers: [{ key: 'pace', value: 'Just right' }] });
    expect(missing.json!.errors).toEqual({ 'answers.0': ['This question needs an answer.'] });
    expect((await b.post(SURVEY, { answers: 'nope' })).json!.errors.answers[0]).toBe(
      'The answers field must be a list of at most 50 answers.',
    );
    // Nothing answered at all (only optional questions in an edited form): the form-level error.
    const t = allTenants().find((x) => x.site.slug === 'amplify')!;
    const row = t.courses.flatMap((c) => c.modules.flatMap((m) => m.lessons)).find((l) => l.id === 'les_l_2_8')!;
    row.survey!.fields[0]!.required = false;
    const none = await b.post(SURVEY, { answers: [{ key: 'recommend', value: false }] });
    expect(none.status).toBe(422);
    expect(none.json!.errors).toEqual({ answers: ['Answer at least one question.'] });
  });

  it('stores the answers, completes the lesson, then lets the learner edit them (re-submitting on)', async () => {
    const b = await learner();
    const res = await b.post(SURVEY, {
      answers: [
        { key: 'rating', value: 5 },
        { key: 'highlight', value: '  The peer reviews  ' },
        { key: 'pace', value: 'Just right' },
        { key: 'recommend', value: true },
        { key: 'hours', value: '3.5' },
      ],
    });
    expect(res.status).toBe(201);
    const { survey, completed, progress } = res.json!.data;
    expect(completed).toBe(true);
    expect(progress).toMatchObject({ completed: expect.any(Number), total: expect.any(Number), percent: expect.any(Number) });
    expect(survey.can_submit).toBe(true);
    expect(survey.response).toMatchObject({ submissions: 1, submitted_at: expect.stringMatching(/^\d{4}-/) });
    expect(survey.response.answers).toEqual([
      { key: 'rating', label: 'How would you rate Launch Lab?', type: 'rating', value: 5 },
      { key: 'highlight', label: 'What helped you most?', type: 'long_text', value: 'The peer reviews' },
      { key: 'pace', label: 'How was the pace?', type: 'choice', value: 'Just right' },
      { key: 'recommend', label: 'I would recommend Launch Lab to a friend', type: 'checkbox', value: true },
      { key: 'hours', label: 'Hours spent per week', type: 'number', value: 3.5 },
    ]);
    const lesson = (await b.get(LESSON)).json!.data;
    expect(lesson).toMatchObject({ completed: true, completion: { rule: 'survey', done: true } });
    expect(lesson.survey.response.submissions).toBe(1);

    const again = await b.post(SURVEY, { answers: [{ key: 'rating', value: 4 }] });
    expect(again.status).toBe(201);
    expect(again.json!.data.survey.response.submissions).toBe(2);
    expect(again.json!.data.survey.response.answers[1]).toMatchObject({ key: 'highlight', value: null });
  });

  it('refuses a second answer when re-submitting is off, and learners who are not enrolled', async () => {
    const b = await learner();
    const t = allTenants().find((x) => x.site.slug === 'amplify')!;
    const row = t.courses.flatMap((c) => c.modules.flatMap((m) => m.lessons)).find((l) => l.id === 'les_l_2_8')!;
    row.survey!.allowResubmit = false;
    expect((await b.post(SURVEY, { answers: [{ key: 'rating', value: 3 }] })).status).toBe(201);
    expect((await b.get(LESSON)).json!.data.survey).toMatchObject({ allow_resubmit: false, can_submit: false });
    const twice = await b.post(SURVEY, { answers: [{ key: 'rating', value: 2 }] });
    expect(twice.status).toBe(409);
    expect(twice.json).toMatchObject({ message: 'You’ve already answered this survey.', code: 'conflict' });
    expect((await b.post('/api/v1/me/lessons/les_l_2_1/survey', { answers: [] })).status).toBe(404);

    const stranger = browser('amplify');
    await stranger.get('/sanctum/csrf-cookie');
    await stranger.post('/api/v1/auth/register', { name: 'Sam Lee', email: 'sam.survey@example.com', password: 'password-123' });
    expect((await stranger.post(SURVEY, { answers: [{ key: 'rating', value: 5 }] })).status).toBe(403);
  });
});

describe('staff preview (course builder O7)', () => {
  const WORKING = 'pv_launchlab_working_day0_demo_000000000000';
  const PUBLISHED = 'pv_launchlab_published_day15_demo_00000000';
  const EXPIRED = 'pv_launchlab_expired_demo_0000000000000000';
  const EXPIRED_MESSAGE = 'This preview has expired — open it again from the builder.';
  type Json = Record<string, any>;
  const raw = (path: string, init: { method?: string; body?: unknown } = {}, tenant = 'amplify') =>
    app.request(path, {
      method: init.method ?? 'GET',
      headers: {
        'X-Tenant': tenant,
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  const data = async (path: string, tenant = 'amplify') => ((await (await raw(path, {}, tenant)).json()) as { data: Json }).data;
  const post = (path: string, body: unknown) => raw(path, { method: 'POST', body });
  const lessonsOf = (course: Json): Json[] => (course.modules as { lessons: Json[] }[]).flatMap((m) => m.lessons);

  it('serves the course for a virtual learner with the simulation, uncached, unindexed and without cookies', async () => {
    const res = await raw(`/api/v1/preview/${WORKING}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.getSetCookie()).toEqual([]);
    const { data: session } = (await res.json()) as { data: Json };
    expect(session.simulation).toEqual({ now: expect.any(String), day: 0, content: 'working' });
    expect(new Date(session.expires_at as string).getTime()).toBeGreaterThan(Date.now());
    expect(session.course).toMatchObject({ slug: 'launch-lab', progress: { completed: 0, percent: 0 }, community_space: null });
    const lessons = lessonsOf(session.course as Json);
    expect(lessons.every((l) => l.completed === false)).toBe(true);
    // O4 for a learner enrolled today with nothing completed: the drip (14 days), date and after-item locks.
    expect(lessons.find((l) => l.id === 'les_l_2_5')).toMatchObject({ locked: true, lock_reason: 'drip', unlocks_at: expect.any(String) });
    expect(lessons.find((l) => l.id === 'les_l_2_6')).toMatchObject({ locked: true, lock_reason: 'date' });
    expect(lessons.find((l) => l.id === 'les_l_2_7')).toMatchObject({
      locked: true,
      lock_reason: 'after_item',
      after: { id: 'les_l_2_1' },
    });
    expect(lessons.find((l) => l.id === 'les_l_0_0')).toMatchObject({ locked: false, lock_reason: null, draft: false });
    // The working copy: its draft lesson shows, flagged.
    expect(lessons.find((l) => l.id === 'les_l_draft_0')).toMatchObject({ draft: true, locked: false });
  });

  it('simulates the day and hides drafts in published mode', async () => {
    const session = await data(`/api/v1/preview/${PUBLISHED}`);
    expect(session.simulation).toMatchObject({ day: 15, content: 'published' });
    const lessons = lessonsOf(session.course as Json);
    expect(lessons.some((l) => l.id === 'les_l_draft_0')).toBe(false);
    // Day 15: the 14-day drip is open; the date lock (21 days ahead) isn't.
    expect(lessons.find((l) => l.id === 'les_l_2_5')).toMatchObject({ locked: false });
    expect(lessons.find((l) => l.id === 'les_l_2_6')).toMatchObject({ locked: true, lock_reason: 'date' });
    expect((await raw(`/api/v1/preview/${PUBLISHED}/lessons/les_l_draft_0`)).status).toBe(404);
  });

  it('answers 404 with the expired message for unknown, expired and other schools’ tokens', async () => {
    const cases: [string, string, boolean][] = [
      [`/api/v1/preview/${EXPIRED}`, 'amplify', false],
      ['/api/v1/preview/pv_unknown_token_00000000000000000000000000', 'amplify', false],
      [`/api/v1/preview/${WORKING}`, 'northwind', false],
      [`/api/v1/preview/${EXPIRED}/lessons/les_l_0_0`, 'amplify', false],
      [`/api/v1/preview/${EXPIRED}/lessons/les_l_2_2/blocks/blk_plan000000000002/check`, 'amplify', true],
    ];
    for (const [path, tenant, isPost] of cases) {
      const res = await raw(path, isPost ? { method: 'POST', body: { option_ids: ['a'] } } : {}, tenant);
      expect(res.status, path).toBe(404);
      expect(((await res.json()) as { message: string }).message).toBe(EXPIRED_MESSAGE);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('keeps locked lessons viewable with the learner’s lock sentence', async () => {
    const res = await raw(`/api/v1/preview/${WORKING}/lessons/les_l_2_5`);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const { data: locked } = (await res.json()) as { data: Json };
    expect(locked).toMatchObject({ id: 'les_l_2_5', type: 'video', completed: false, note: '', questions: [] });
    expect(locked.preview_lock).toEqual({ reason: 'drip', unlocks_at: expect.any(String), text: 'Opens in 14 days' });
    expect((await data(`/api/v1/preview/${WORKING}/lessons/les_l_2_7`)).preview_lock).toMatchObject({
      reason: 'after_item',
      text: 'Complete “Launch-day checklist” first',
    });
    expect((await data(`/api/v1/preview/${WORKING}/lessons/les_l_2_6`)).preview_lock).toMatchObject({
      reason: 'date',
      text: expect.stringMatching(/^Opens on /),
    });
    const open = await data(`/api/v1/preview/${WORKING}/lessons/les_l_0_0`);
    expect(open.preview_lock).toBeNull();
    // Never a learner endpoint: downloads are signed storage URLs.
    expect(JSON.stringify(open)).not.toContain('/me/');
  });

  it('sends quizzes without questions and assignments without a submission', async () => {
    expect((await data(`/api/v1/preview/${WORKING}/lessons/les_l_0_2`)).quiz).toMatchObject({
      questions: [],
      last_result: null,
      attempts_used: 0,
    });
    expect((await data(`/api/v1/preview/${WORKING}/lessons/les_l_1_2`)).assignment).toMatchObject({
      submission: null,
      can_submit: false,
      peer_review: null,
      brief: expect.any(String),
    });
  });

  it('sends every block (gates open client-side) and grades checks and sorting statelessly, without a session or CSRF', async () => {
    const url = `/api/v1/preview/${WORKING}/lessons/les_l_draft_0`;
    const lesson = await data(url);
    expect(lesson).toMatchObject({ draft: true, blocks_locked: 0 });
    const blocks = lesson.blocks as Json[];
    expect(blocks.map((b) => b.id)).toEqual(expect.arrayContaining(['blk_demo000000000020', 'blk_demo000000000021']));
    expect(blocks.find((b) => b.type === 'continue')).toMatchObject({ passed: false });

    const check = await post(`${url}/blocks/blk_demo000000000018/check`, { option_ids: ['b'] });
    expect(check.status).toBe(200);
    expect(check.headers.getSetCookie()).toEqual([]);
    expect(((await check.json()) as { data: Json }).data).toMatchObject({ correct: true, correct_option_ids: ['b'] });
    // Blocks behind the gate can be answered too (the gate is the browser's).
    expect((await post(`${url}/blocks/blk_demo000000000021/check`, { option_ids: ['a'] })).status).toBe(200);
    const sort = await post(`${url}/blocks/blk_demo000000000019/sort`, {
      placements: { ads: 'attract', seo: 'attract', form: 'convert', magnet: 'attract' },
    });
    expect(((await sort.json()) as { data: Json }).data).toEqual({
      correct: false,
      results: { ads: true, seo: true, form: true, magnet: false },
    });
    expect((await post(`${url}/blocks/blk_demo000000000019/sort`, { placements: { ads: 'attract' } })).status).toBe(422);
    expect((await post(`${url}/blocks/blk_demo000000000018/check`, { option_ids: ['zz'] })).status).toBe(422);
    expect((await post(`${url}/blocks/blk_nope/check`, { option_ids: ['a'] })).status).toBe(404);
    // No continue endpoint in preview.
    expect((await post(`${url}/blocks/blk_demo000000000020/continue`, {})).status).toBe(404);

    // Nothing was recorded: the lesson still has no answers, and the school has no responses or gates.
    expect(((await data(url)).blocks as Json[]).filter((b) => b.state != null)).toEqual([]);
    const amplify = allTenants().find((t) => t.site.slug === 'amplify')!;
    expect(amplify.blockResponses ?? []).toEqual([]);
    expect(amplify.blockGates ?? []).toEqual([]);
  });

  it('throttles answers to 60 a minute per token', async () => {
    const path = (token: string) => `/api/v1/preview/${token}/lessons/les_l_2_2/blocks/blk_plan000000000003/check`;
    for (let i = 0; i < 60; i++) expect((await post(path(PUBLISHED), { text: 'sales' })).status).toBe(200);
    expect((await post(path(PUBLISHED), { text: 'sales' })).status).toBe(429);
    // Each token has its own budget.
    expect((await post(path(WORKING), { text: 'sales' })).status).toBe(200);
  });

  it('never shows the working copy’s drafts to learners', async () => {
    const b = browser('amplify');
    await b.signIn();
    expect((await b.get('/api/v1/me/lessons/les_l_draft_0')).status).toBe(404);
    expect(JSON.stringify((await b.get('/api/v1/courses/launch-lab')).json)).not.toContain('les_l_draft_0');
  });
});

describe('community replies, reports and held posts', () => {
  it('reads and writes replies, reports posts with a reason and holds links from new members', async () => {
    const guest = browser('amplify');
    const replies = await guest.get('/api/v1/community/posts/post_1/replies');
    expect(replies.status).toBe(200);
    expect(replies.json!.data).toHaveLength(12);
    expect(replies.json!.data[0]).toMatchObject({
      id: expect.any(String),
      body: expect.any(String),
      author: { name: expect.any(String), is_instructor: false },
    });
    expect((await guest.post('/api/v1/community/posts/post_1/replies', { body: 'Hi' })).status).toBe(419); // no CSRF cookie yet
    expect((await guest.get('/api/v1/community/posts/nope/replies')).status).toBe(404);

    const me = browser('amplify');
    await me.signIn();
    expect((await me.post('/api/v1/community/posts/post_1/replies', { body: 'x' })).status).toBe(422);
    const replied = await me.post('/api/v1/community/posts/post_1/replies', { body: 'Thanks for the review!' });
    expect(replied.status).toBe(201);
    expect(replied.json!.data).toMatchObject({ id: 'post_1', replies: 13, held: false });
    const thread = (await me.get('/api/v1/community/posts/post_1/replies')).json!.data as { body: string }[];
    expect(thread[thread.length - 1]).toMatchObject({ body: 'Thanks for the review!' });

    expect((await me.post('/api/v1/community/posts/post_1/flags', { reason: 'rude' })).status).toBe(422);
    const flagged = await me.post('/api/v1/community/posts/post_1/flags', { reason: 'spam' });
    expect(flagged.status).toBe(202);
    expect(flagged.json!.data).toEqual({ flagged: true });

    const held = await me.post('/api/v1/community/posts', { space_id: 'sp_wins', body: 'My page: https://example.com/launch' });
    expect(held.status).toBe(201);
    expect(held.json!.data.held).toBe(true);
    const feed = await me.get('/api/v1/community/posts?space=sp_wins');
    expect((feed.json!.data as { id: string }[]).map((p) => p.id)).not.toContain(held.json!.data.id);
  });
});

describe('help centre articles and search', () => {
  it('lists categories with excerpts, serves an article with related ones, and 404s unknown slugs', async () => {
    const g = browser('amplify');
    const cats = (await g.get('/api/v1/help')).json!.data as {
      title: string;
      articles: { slug: string; title: string; excerpt: string }[];
    }[];
    const billing = cats.find((c) => c.title === 'Billing & receipts')!;
    expect(billing.articles[0]).toEqual({
      slug: 'find-your-invoice',
      title: 'Find your invoice',
      excerpt: expect.stringContaining('Every order has an invoice. Open the order'),
    });
    const art = await g.get('/api/v1/help/articles/find-your-invoice');
    expect(art.status).toBe(200);
    expect(art.json!.data).toMatchObject({ category: 'Billing & receipts', title: 'Find your invoice', updated_at: expect.any(String) });
    expect(art.json!.data.body).toContain('## Need a company invoice?');
    expect((art.json!.data.related as { slug: string }[]).map((r) => r.slug)).toEqual([
      'update-your-card',
      'apply-a-coupon',
      'payment-plans-explained',
    ]);
    expect((await g.get('/api/v1/help/articles/nope')).status).toBe(404);
  });

  it('searches every word, title matches first, and ignores one-letter queries', async () => {
    const g = browser('amplify');
    const hits = (await g.get('/api/v1/help/search?q=invoice')).json!.data as { slug: string; category: string; excerpt: string }[];
    expect(hits[0]).toMatchObject({ slug: 'find-your-invoice', category: 'Billing & receipts' });
    expect(((await g.get('/api/v1/help/search?q=company+vat')).json!.data as { slug: string }[]).map((h) => h.slug)).toEqual([
      'find-your-invoice',
    ]);
    expect((await g.get('/api/v1/help/search?q=a')).json!.data).toEqual([]);
    expect((await g.get('/api/v1/help/search?q=zzzz')).json!.data).toEqual([]);
  });
});

describe('SEO on the storefront (docs/api/pages.md → SEO)', () => {
  const call = (path: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) =>
    app.request(path, { ...init, headers: { Accept: 'application/json', 'X-Tenant': 'amplify', ...init.headers } });

  it('serves the school’s settings, per-page overrides and sitemap URLs', async () => {
    const res = await call('/api/v1/seo');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, any> };
    expect(data.title_template).toBe('{page} · {school}');
    expect(data.schema_types).toEqual({
      organization: true,
      course: true,
      product: true,
      breadcrumbs: true,
      faq: true,
      article: true,
      person: true,
    });
    expect(data.pages).toContainEqual(expect.objectContaining({ path: '/courses/launch-lab', noindex: true, in_sitemap: true }));
    expect(data.sitemap.length).toBeGreaterThan(0);
  });

  it('gives the redirect table and hit counter to the site server only', async () => {
    expect((await call('/api/v1/seo/redirects')).status).toBe(401);
    const res = await call('/api/v1/seo/redirects', { headers: SERVICE });
    const { data } = (await res.json()) as { data: { id: string; from: string; keep_query: boolean }[] };
    expect(data.map((r) => r.from)).toContain('/old-blog/*');
    expect((await call('/api/v1/seo/redirects/rd_old_courses/hits', { method: 'POST', headers: SERVICE })).status).toBe(204);
    const hook = (await (await call('/__mock/seo')).json()) as { data: { redirects: { id: string; hits: number }[] } };
    expect(hook.data.redirects.find((r) => r.id === 'rd_old_courses')?.hits).toBe(1);
  });

  it('records 404 reports from the site server only, without bots or query strings', async () => {
    const report = (body: Record<string, unknown>, ua = 'Mozilla/5.0 Safari/605', headers: Record<string, string> = SERVICE) =>
      call('/api/v1/seo/not-found', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitor_ip: '203.0.113.7', user_agent: ua, ...body }),
      });
    // A browser (no service token) is refused: by the CSRF check here, by the service token at the API.
    expect((await report({ path: '/forged', internal: true }, undefined, {})).status).toBeGreaterThanOrEqual(400);
    expect((await report({ path: '/gone?token=secret', referrer: 'https://www.google.com/search?q=x' })).status).toBe(204);
    expect((await report({ path: '/bot-page' }, 'Googlebot/2.1')).status).toBe(204);
    expect((await report({ path: '/old-courses' })).status).toBe(204);
    expect((await report({ path: 'no-slash' })).status).toBe(422);
    const hook = (await (await call('/__mock/seo')).json()) as { data: { not_found: { path: string; referrer_host: string | null }[] } };
    expect(hook.data.not_found).toEqual([{ path: '/gone', referrer_host: 'www.google.com', hits: 1 }]);
  });
});
