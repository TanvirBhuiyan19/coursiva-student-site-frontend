/**
 * Contract tests for the API the learner site depends on. They run against the mock, and describe exactly what the
 * Laravel implementation must do: tenant isolation, Sanctum CSRF + session cookies, server-side pricing and grading.
 */
import { app } from './app';
import { reset } from './lib/db';

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
  return {
    jar,
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

describe('platform', () => {
  it('resolves hosts to tenants (subdomain and custom domain), server-to-server only', async () => {
    const sub = await app.request('/platform/v1/domains/resolve?host=amplify.localhost', { headers: SERVICE });
    expect(((await sub.json()) as { data: { tenant: string } }).data.tenant).toBe('amplify');
    const custom = await app.request('/platform/v1/domains/resolve?host=learn.northwindyoga.test', { headers: SERVICE });
    expect(((await custom.json()) as { data: { tenant: string } }).data.tenant).toBe('northwind');
    expect((await app.request('/platform/v1/domains/resolve?host=nope.localhost', { headers: SERVICE })).status).toBe(404);
    expect((await app.request('/platform/v1/domains/resolve?host=amplify.localhost')).status).toBe(401);
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
    expect(vat.tax_label).toBe('VAT 20%');
    expect(vat.total.amount).toBe(29900);
    const plan = await quote({ target, plan: 'installments', seats: 1, country: 'United States' });
    expect(plan.installments).toEqual({ count: 3, amount: { amount: 8800, currency: 'USD' } });
    expect(plan.due_today.amount).toBe(8800);
  });
  it('multiplies by seats and flags invalid coupons', async () => {
    const q = await quote({ target, plan: 'full', seats: 3, coupon_code: 'NOPE', country: 'United States' });
    expect(q.subtotal.amount).toBe(74700);
    expect(q.coupon).toEqual({ code: 'NOPE', valid: false, message: 'That code isn’t valid' });
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
    const order = await b.post('/api/v1/checkout', body);
    expect(order.status).toBe(201);
    expect(order.json!.data.total.amount).toBe(14900);
    expect(order.json!.data.start_lesson.course_slug).toBe('client-acquisition-sprint');
    const mine = await b.get('/api/v1/me/enrollments');
    expect((mine.json!.data as { course_slug: string }[]).some((e) => e.course_slug === 'client-acquisition-sprint')).toBe(true);
    expect((await b.post('/api/v1/checkout', body)).json!.errors.target[0]).toMatch(/already own/);
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
    expect(certs.at(-1)!.verify_url).toMatch(/^https:\/\/verify\.coursiva\.io\//);
  });
  it('blocks the player for courses the learner does not own', async () => {
    const b = browser('amplify');
    await b.signIn();
    expect((await b.get('/api/v1/me/courses/podcast-launchpad')).status).toBe(403);
  });
});
