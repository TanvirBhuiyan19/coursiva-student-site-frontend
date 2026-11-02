/**
 * The public lead-form API (docs/api/forms.md): no session, no CSRF (the signed form token is the proof), CORS `*`
 * without credentials. Registered before the CSRF middleware, like Laravel's CSRF-exempt routes. Rate limits are
 * Laravel's job and not simulated here.
 */
import { randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { type AppContext, type Env, allTenants, withTenant } from '../lib/db';
import {
  TURNSTILE_TEST,
  acceptUpload,
  answers,
  countView,
  formsOf,
  httpUrl,
  liveForm,
  mintToken,
  publicForm,
  utmOf,
  verifyToken,
} from '../lib/forms';
import { ok } from '../lib/http';

export const formRoutes = new Hono<Env>();

const EXPIRED = 'This form has expired. Reload the page and try again.';

/** A 422 whose keys are sent verbatim (`values.first_name`: field keys are data, never case-converted). */
const invalidRaw = (c: Context, errors: Record<string, string>) =>
  c.json(
    {
      message: Object.values(errors)[0] ?? 'The given data was invalid.',
      errors: Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, [v]])),
    },
    422,
  );

const notFound = (c: Context) => c.json({ message: 'Form not found.' }, 404);

formRoutes.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Accept-Language, X-Requested-With',
      'Access-Control-Max-Age': '600',
    });
  }
  await next();
  c.res.headers.set('Access-Control-Allow-Origin', '*');
});
formRoutes.use('*', withTenant);

/** Raw JSON body (not camelized: `values` keys are data). */
async function rawBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const b: unknown = await c.req.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const clientIp = (c: Context) => (c.req.header('x-forwarded-for') ?? '127.0.0.1').split(',')[0]!.trim();

formRoutes.get('/:form', (c: AppContext) => {
  const t = c.get('t');
  const f = liveForm(t, c.req.param('form') ?? '');
  if (!f) return notFound(c);
  c.header('Cache-Control', 'private, no-store');
  return ok(c, publicForm(f, mintToken(t, f.id)));
});

formRoutes.post('/:form/views', async (c: AppContext) => {
  const t = c.get('t');
  const f = liveForm(t, c.req.param('form') ?? '');
  if (!f) return notFound(c);
  if (verifyToken(t, f.id, (await rawBody(c)).token) === null) return invalidRaw(c, { token: EXPIRED });
  countView(t, f, clientIp(c), c.req.header('user-agent') ?? '');
  return c.body(null, 204);
});

formRoutes.post('/:form/uploads', async (c: AppContext) => {
  const t = c.get('t');
  const f = liveForm(t, c.req.param('form') ?? '');
  if (!f) return notFound(c);
  let form: Record<string, unknown> = {};
  try {
    form = await c.req.parseBody();
  } catch {
    form = {};
  }
  if (verifyToken(t, f.id, form.token) === null) return invalidRaw(c, { token: EXPIRED });
  const r = await acceptUpload(t, f, form.field, form.file);
  if ('errors' in r) return invalidRaw(c, r.errors);
  return ok(c, { id: r.upload.id, name: r.upload.name, sizeBytes: r.upload.sizeBytes }, 201);
});

formRoutes.post('/:form/submissions', async (c: AppContext) => {
  const t = c.get('t');
  const f = liveForm(t, c.req.param('form') ?? '');
  if (!f) return notFound(c);
  const b = await rawBody(c);
  const issued = verifyToken(t, f.id, b.token);
  if (issued === null) return invalidRaw(c, { token: EXPIRED });
  // The honeypot: answered like a success, nothing stored.
  if (typeof b.website === 'string' && b.website.trim() !== '') {
    f.spamBlocked++;
    return ok(
      c,
      {
        received: true,
        confirmationRequired: false,
        submissionId: null,
        successMessage: f.settings.successMessage || 'Thanks! We got your submission.',
        redirectUrl: f.settings.redirectUrl,
      },
      201,
    );
  }
  if (Date.now() / 1000 - issued < f.settings.minFillSeconds) {
    f.spamBlocked++;
    return invalidRaw(c, { token: 'That was quick! Please wait a moment and submit again.' });
  }
  if (f.settings.turnstile && b.turnstile_token !== TURNSTILE_TEST.token) {
    f.spamBlocked++;
    return invalidRaw(c, { turnstile_token: 'Complete the anti-spam check and try again.' });
  }
  const a = answers(t, f, b.values);
  if ('errors' in a) return invalidRaw(c, a.errors);
  const pageUrl = httpUrl(b.page_url);
  const id = `fsb_${randomBytes(13).toString('hex').slice(0, 26)}`;
  const s = formsOf(t);
  s.submissions.push({
    id,
    formId: f.id,
    email: a.ok.email,
    values: a.ok.values,
    consents: a.ok.consents,
    pageUrl,
    referrer: httpUrl(b.referrer),
    utm: utmOf(pageUrl),
    tracking: b.tracking ?? null,
    createdAt: new Date().toISOString(),
  });
  for (const u of a.ok.uploads) u.submissionId = id;
  if (a.ok.email && !t.newsletter.includes(a.ok.email) && !f.doubleOptIn) t.newsletter.push(a.ok.email);
  const pending = f.doubleOptIn;
  return ok(
    c,
    {
      received: true,
      confirmationRequired: pending,
      submissionId: id,
      successMessage: pending
        ? 'Thanks! Check your inbox to confirm your subscription.'
        : f.settings.successMessage || 'Thanks! We got your submission.',
      redirectUrl: f.settings.redirectUrl,
    },
    201,
  );
});

/** Test hook (never in the real API): a form's counters, submissions and uploads. `GET /__mock/forms/{tenant}/{form}`. */
export const formHooks = new Hono();
formHooks.get('/:tenant/:form', (c) => {
  const t = allTenants().find((x) => x.resolution.tenant === c.req.param('tenant'));
  if (!t) return c.json({ message: 'Unknown tenant.' }, 404);
  const s = formsOf(t);
  const f = s.forms.find((x) => x.id === c.req.param('form'));
  if (!f) return c.json({ message: 'Form not found.' }, 404);
  return c.json({
    views: f.views,
    spam_blocked: f.spamBlocked,
    submissions: s.submissions.filter((x) => x.formId === f.id),
    uploads: s.uploads.filter((x) => x.formId === f.id),
  });
});
