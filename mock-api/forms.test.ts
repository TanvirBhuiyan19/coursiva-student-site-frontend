/**
 * Contract tests for the public lead-form API (docs/api/forms.md), run against the mock — which ports Laravel's
 * public form endpoints, so these describe what Laravel (and Go) return.
 */
import { app } from './app';
import { allTenants, reset } from './lib/db';
import { SEED_FORMS, TURNSTILE_TEST, formsOf, mintToken } from './lib/forms';

type Json = Record<string, any>;

const amplify = () => allTenants().find((x) => x.site.slug === 'amplify')!;
const base = (id: string) => `/api/v1/forms/${id}`;

async function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const multipart = body instanceof FormData;
  const res = await app.request(path, {
    method,
    headers: {
      'X-Tenant': 'amplify',
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (test)',
      ...(body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? (JSON.parse(text) as Json) : null };
}

/** A token issued long enough ago to pass the minimum fill time. */
const oldToken = (id: string) => mintToken(amplify(), id, Math.floor(Date.now() / 1000) - 120);

const pdf = (name = 'cv.pdf', size = 64) => {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
  return new File([bytes], name, { type: 'application/pdf' });
};

async function upload(file: File, field = 'portfolio', token = oldToken(SEED_FORMS.workshop)) {
  const fd = new FormData();
  fd.append('token', token);
  fd.append('field', field);
  fd.append('file', file);
  return send('POST', `${base(SEED_FORMS.workshop)}/uploads`, fd);
}

const goodValues = (extra: Json = {}) => ({
  name: 'Jordan Tate',
  email: 'Jordan.Tate@Example.com',
  role: 'Coach',
  consent: true,
  ...extra,
});

beforeEach(() => reset());

describe('GET /forms/{id}', () => {
  it('returns the public form with normalised fields, a token and no caching', async () => {
    const res = await send('GET', base(SEED_FORMS.workshop));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const f = res.json!.data;
    expect(f).toMatchObject({
      id: SEED_FORMS.workshop,
      name: 'Workshop application',
      title: 'Apply for the live workshop',
      submit_label: 'Send application',
      redirect_url: null,
      turnstile_site_key: null,
      double_opt_in: false,
      min_fill_seconds: 3,
    });
    expect(f.token).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{32}$/);
    const types = new Set((f.fields as Json[]).map((x: Json) => x.type));
    for (const type of [
      'text',
      'long_text',
      'email',
      'phone',
      'number',
      'choice',
      'checkbox',
      'rating',
      'date',
      'url',
      'hidden',
      'consent',
      'file',
    ])
      expect(types.has(type), type).toBe(true);
    for (const x of f.fields)
      expect(Object.keys(x).sort()).toEqual(
        ['consent', 'file', 'help', 'key', 'label', 'options', 'placeholder', 'prefill', 'required', 'rules', 'show_if', 'type'].sort(),
      );
    expect((f.fields as Json[]).find((x: Json) => x.key === 'role_other')!.show_if).toEqual({ field: 'role', equals: 'Other' });
    expect((f.fields as Json[]).find((x: Json) => x.key === 'portfolio')!.file).toEqual({ accept: ['pdf', 'image'], max_mb: 2 });
    // Static prefill values stay on the server.
    expect((f.fields as Json[]).find((x: Json) => x.key === 'channel')!.prefill).toEqual({ source: 'static', param: '' });
  });

  it('applies the defaults and the Turnstile site key', async () => {
    const f = (await send('GET', base(SEED_FORMS.partners))).json!.data;
    expect(f).toMatchObject({
      submit_label: 'Submit',
      success_message: 'Thanks! We got your submission.',
      turnstile_site_key: TURNSTILE_TEST.siteKey,
    });
  });

  it('404s paused and unknown forms', async () => {
    for (const id of [SEED_FORMS.paused, 'frm_nope']) {
      const res = await send('GET', base(id));
      expect(res.status).toBe(404);
      expect(res.json!.message).toBe('Form not found.');
    }
    expect((await app.request(base(SEED_FORMS.workshop), { headers: { 'X-Tenant': 'northwind' } })).status).toBe(404);
  });
});

describe('POST /forms/{id}/views', () => {
  it('counts one view per visitor per day, never bots, and needs a valid token', async () => {
    const token = (await send('GET', base(SEED_FORMS.workshop))).json!.data.token;
    expect((await send('POST', `${base(SEED_FORMS.workshop)}/views`, { token })).status).toBe(204);
    expect((await send('POST', `${base(SEED_FORMS.workshop)}/views`, { token })).status).toBe(204);
    expect((await send('POST', `${base(SEED_FORMS.workshop)}/views`, { token }, { 'User-Agent': 'Googlebot/2.1' })).status).toBe(204);
    expect((await send('POST', `${base(SEED_FORMS.workshop)}/views`, { token }, { 'X-Forwarded-For': '203.0.113.9' })).status).toBe(204);
    expect(formsOf(amplify()).forms.find((f) => f.id === SEED_FORMS.workshop)!.views).toBe(2);
    const bad = await send('POST', `${base(SEED_FORMS.workshop)}/views`, { token: `${token}x` });
    expect(bad.status).toBe(422);
    expect(bad.json!.errors.token).toEqual(['This form has expired. Reload the page and try again.']);
    // A token for another form doesn't count either.
    const other = await send('POST', `${base(SEED_FORMS.workshop)}/views`, { token: oldToken(SEED_FORMS.waitlist) });
    expect(other.status).toBe(422);
  });
});

describe('POST /forms/{id}/uploads', () => {
  it('stores an allowed file and answers {id, name, size_bytes}', async () => {
    const res = await upload(pdf());
    expect(res.status).toBe(201);
    expect(res.json!.data).toEqual({ id: expect.stringMatching(/^fup_[0-9a-z]{26}$/), name: 'cv.pdf', size_bytes: 64 });
  });

  it('rejects unknown fields, missing files, wrong types, mismatched content and big files', async () => {
    expect((await upload(pdf(), 'email')).json!.errors).toEqual({ field: ['This form has no such file field.'] });
    const empty = new FormData();
    empty.append('token', oldToken(SEED_FORMS.workshop));
    empty.append('field', 'portfolio');
    expect((await send('POST', `${base(SEED_FORMS.workshop)}/uploads`, empty)).json!.errors).toEqual({ file: ['Upload a file.'] });
    expect((await upload(new File(['hello'], 'notes.txt'))).json!.errors).toEqual({ file: ["This file type isn't allowed."] });
    expect((await upload(new File(['not a pdf at all'], 'fake.pdf'))).json!.errors).toEqual({ file: ["This file type isn't allowed."] });
    const big = await upload(pdf('big.pdf', 2 * 1024 * 1024 + 1));
    expect(big.status).toBe(422);
    expect(big.json!.errors).toEqual({ file: ['The file must not be larger than 2 MB.'] });
    expect((await upload(pdf(), 'portfolio', 'forged.0123')).json!.errors.token).toBeDefined();
  });
});

describe('POST /forms/{id}/submissions', () => {
  const submit = (id: string, body: Json) => send('POST', `${base(id)}/submissions`, body);

  it('stores a valid submission with its values, consents, page, utm and file', async () => {
    const up = (await upload(pdf())).json!.data;
    const res = await submit(SEED_FORMS.workshop, {
      token: oldToken(SEED_FORMS.workshop),
      values: goodValues({ portfolio: up.id, excitement: 5, team_size: '12', newsletter: 'true', channel: 'tampered', utm_source: 'news' }),
      website: '',
      page_url: 'https://amplify.example.com/forms/x?utm_source=news&utm_campaign=fall&utm_medium=',
      referrer: 'javascript:alert(1)',
      tracking: { fbp: 'fb.1.2' },
    });
    expect(res.status).toBe(201);
    expect(res.json!.data).toEqual({
      received: true,
      confirmation_required: false,
      submission_id: expect.stringMatching(/^fsb_[0-9a-z]{26}$/),
      success_message: 'Thanks! We’ll review your application within two days.',
      redirect_url: null,
    });
    const hook = (await (await app.request(`/__mock/forms/amplify/${SEED_FORMS.workshop}`)).json()) as Json;
    const s = hook.submissions[0];
    const value = (k: string) => (s.values as Json[]).find((v: Json) => v.key === k)!.value;
    expect(value('email')).toBe('jordan.tate@example.com');
    expect(value('channel')).toBe('website-form');
    expect(value('role_other')).toBeNull();
    expect(value('newsletter')).toBe(true);
    expect(value('team_size')).toBe(12);
    expect(value('portfolio')).toEqual({ id: up.id, name: 'cv.pdf', sizeBytes: 64 });
    expect((s.values as Json[]).map((v: Json) => v.key)).toEqual(formsOf(amplify()).forms[0]!.fields.map((f) => f.key));
    expect(s.consents).toEqual([expect.objectContaining({ key: 'consent', version: '2026-10' })]);
    expect(s.utm).toEqual({ source: 'news', campaign: 'fall' });
    expect(s.referrer).toBeNull();
    expect(hook.uploads[0].submissionId).toBe(s.id);
    // An upload is used once.
    const again = await submit(SEED_FORMS.workshop, { token: oldToken(SEED_FORMS.workshop), values: goodValues({ portfolio: up.id }) });
    expect(again.json!.errors).toEqual({ 'values.portfolio': ['Upload the file again.'] });
  });

  it('answers a filled honeypot like a success and stores nothing', async () => {
    const res = await submit(SEED_FORMS.workshop, { token: oldToken(SEED_FORMS.workshop), values: {}, website: 'https://spam.example' });
    expect(res.status).toBe(201);
    expect(res.json!.data).toMatchObject({ received: true, submission_id: null });
    const f = formsOf(amplify()).forms[0]!;
    expect(f.spamBlocked).toBe(1);
    expect(formsOf(amplify()).submissions).toHaveLength(0);
  });

  it('blocks submissions faster than the minimum fill time', async () => {
    const token = (await send('GET', base(SEED_FORMS.waitlist))).json!.data.token;
    const res = await submit(SEED_FORMS.waitlist, { token, values: { email: 'a@b.co' } });
    expect(res.status).toBe(422);
    expect(res.json!.errors).toEqual({ token: ['That was quick! Please wait a moment and submit again.'] });
    expect(formsOf(amplify()).forms[1]!.spamBlocked).toBe(1);
  });

  it('needs a passing Turnstile token when Turnstile is on; double opt-in changes the message', async () => {
    const token = oldToken(SEED_FORMS.partners);
    const values = { email: 'p@partner.example', company: 'Partner Co' };
    for (const turnstile_token of [undefined, 'bad-token']) {
      const res = await submit(SEED_FORMS.partners, { token, values, turnstile_token });
      expect(res.json!.errors).toEqual({ turnstile_token: ['Complete the anti-spam check and try again.'] });
    }
    const ok = await submit(SEED_FORMS.partners, { token, values, turnstile_token: TURNSTILE_TEST.token });
    expect(ok.status).toBe(201);
    expect(ok.json!.data).toMatchObject({
      confirmation_required: true,
      success_message: 'Thanks! Check your inbox to confirm your subscription.',
      redirect_url: 'https://example.com/thanks',
    });
  });

  it('validates every answer with the exact messages, keyed values.{key}', async () => {
    const token = oldToken(SEED_FORMS.workshop);
    const res = await submit(SEED_FORMS.workshop, {
      token,
      values: {
        name: 'J0rdan',
        email: 'nope',
        phone: '12',
        team_size: 'lots',
        role: 'Other',
        role_other: '',
        website: 'ftp://x',
        start_date: '2026-02-30',
        goals: 'see www.spam.example',
        excitement: 6,
        newsletter: 'maybe',
        portfolio: 'fup_missing',
        consent: false,
      },
    });
    expect(res.status).toBe(422);
    expect(res.json!.errors).toEqual({
      'values.name': ['Use letters only.'],
      'values.email': ['Enter a valid email address.'],
      'values.phone': ['Enter a valid phone number.'],
      'values.team_size': ['Enter a number.'],
      'values.role_other': ['This field is required.'],
      'values.website': ['Enter a valid URL starting with https:// or http://'],
      'values.start_date': ['Enter a valid date.'],
      'values.goals': ["Links aren't allowed here."],
      'values.excitement': ['Choose a rating from 1 to 5.'],
      'values.newsletter': ['Enter a valid value.'],
      'values.portfolio': ['Upload the file again.'],
      'values.consent': ['You must agree to continue.'],
    });
    const limits = await submit(SEED_FORMS.workshop, { token, values: goodValues({ name: 'J', team_size: 0, role: 'Nope' }) });
    expect(limits.json!.errors).toEqual({
      'values.name': ['Enter at least 2 characters.'],
      'values.team_size': ['Enter a number of at least 1.'],
      'values.role': ['Choose one of the options.'],
    });
    expect((await submit(SEED_FORMS.workshop, { token, values: goodValues({ team_size: 10001 }) })).json!.errors).toEqual({
      'values.team_size': ['Enter a number no greater than 10000.'],
    });
    expect((await submit(SEED_FORMS.workshop, { token, values: [] })).json!.errors).toEqual({
      values: ['The values field must be an object.'],
    });
    expect((await submit(SEED_FORMS.workshop, { token: 'x.y', values: goodValues() })).json!.errors.token).toEqual([
      'This form has expired. Reload the page and try again.',
    ]);
    // The conditional field applies once its condition is met, and is enforced then.
    expect((await submit(SEED_FORMS.workshop, { token, values: goodValues({ role: 'Other', role_other: 'Coach' }) })).status).toBe(201);
  });
});

describe('site-builder lead_form sections', () => {
  it('present a form section set to a live lead form as kind lead_form', async () => {
    const page = (await send('GET', '/api/v1/pages/about/team')).json!.data;
    const s = (page.sections as Json[]).find((x: Json) => x.id === 'tm_lead');
    expect(s).toMatchObject({
      kind: 'lead_form',
      form_id: SEED_FORMS.waitlist,
      title: 'Join the waitlist',
      subtitle: 'We’ll email you when the next cohort opens.',
    });
    expect(s!.style).toBeDefined();
  });
});
