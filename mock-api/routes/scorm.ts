/**
 * SCORM & xAPI runtime (Laravel: app/Modules/Scorm, docs/scorm.md): the launch + data model, commits, the package's
 * files (a small demo SCO per runtime — the mock has no uploaded packages) and a minimal xAPI LRS for cmi5 / Tin Can.
 *
 * The data model is keyed by element name (`cmi.core.lesson_status`), so commits are read without case conversion.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ScormLaunch } from '@/features/learning/types';
import { scormLaunchPath, scormState } from '../lib/assessment';
import { type AppContext, type Env, requireUser, withTenant } from '../lib/db';
import { id, invalid, notFound, ok } from '../lib/http';
import { completedSet, findLesson, isEnrolled, progressOf } from '../lib/present';
import type { LessonRow, ScormPackageRow, TenantData, UserRow } from '../lib/records';
import { lessonFor, maybeIssueCertificate } from './learning';

export const scormRoutes = new Hono<Env>();
scormRoutes.use('/me/*', requireUser);

type Attempt = TenantData['scormAttempts'][number];

function ensureAttempt(t: TenantData, user: UserRow, lesson: LessonRow): Attempt {
  let a = t.scormAttempts.find((x) => x.userId === user.id && x.lessonId === lesson.id);
  if (!a) {
    a = {
      userId: user.id,
      lessonId: lesson.id,
      cmi: {},
      completionStatus: 'not_attempted',
      successStatus: 'unknown',
      scoreScaled: null,
      totalSeconds: 0,
      completedAt: null,
      launches: 0,
    };
    t.scormAttempts.push(a);
  }
  return a;
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unb64 = (s: string): Record<string, string> | null => {
  try {
    return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Record<string, string>;
  } catch {
    return null;
  }
};

/** LMS-owned elements (Laravel's READ_ONLY): commits never overwrite them. */
const LMS_OWNED = new Set([
  'cmi.core.student_id',
  'cmi.core.student_name',
  'cmi.core.credit',
  'cmi.core.lesson_mode',
  'cmi.core.entry',
  'cmi.core.total_time',
  'cmi.launch_data',
  'cmi.student_data.mastery_score',
  'cmi._version',
  'cmi.learner_id',
  'cmi.learner_name',
  'cmi.credit',
  'cmi.mode',
  'cmi.entry',
  'cmi.total_time',
  'cmi.scaled_passing_score',
]);

function lmsValues(pkg: ScormPackageRow, user: UserRow, a: Attempt): Record<string, string> {
  const resume = a.launches > 1 || Object.keys(a.cmi).length > 0;
  const secs = a.totalSeconds;
  if (pkg.runtime === 'scorm12') {
    const [first = '', ...rest] = user.name.split(' ');
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return {
      'cmi.core.lesson_status': 'not attempted',
      ...a.cmi,
      'cmi.core.student_id': user.id,
      'cmi.core.student_name': [rest.join(' '), first].filter(Boolean).join(', '),
      'cmi.core.credit': 'credit',
      'cmi.core.lesson_mode': 'normal',
      'cmi.core.entry': resume ? 'resume' : 'ab-initio',
      'cmi.core.total_time': `${pad(Math.floor(secs / 3600), 4)}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}.00`,
      'cmi.launch_data': '',
      'cmi.student_data.mastery_score': pkg.masteryScore !== null ? String(pkg.masteryScore) : '',
    };
  }
  return {
    'cmi.completion_status': 'unknown',
    'cmi.success_status': 'unknown',
    ...a.cmi,
    'cmi._version': '1.0',
    'cmi.learner_id': user.id,
    'cmi.learner_name': user.name,
    'cmi.credit': 'credit',
    'cmi.mode': 'normal',
    'cmi.entry': resume ? 'resume' : 'ab-initio',
    'cmi.total_time': `PT${secs}S`,
    'cmi.launch_data': '',
    ...(pkg.masteryScore !== null ? { 'cmi.scaled_passing_score': String(pkg.masteryScore / 100) } : {}),
  };
}

/** `0000:02:30.00` (1.2) or `PT2M30S` (2004) → seconds. */
export function sessionSeconds(v: string): number {
  const hms = /^(\d{2,4}):(\d{2}):(\d{2})(\.\d+)?$/.exec(v);
  if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
  const iso = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/.exec(v);
  if (!iso) return 0;
  return Number(iso[1] ?? 0) * 86_400 + Number(iso[2] ?? 0) * 3600 + Number(iso[3] ?? 0) * 60 + Math.floor(Number(iso[4] ?? 0));
}

function status(pkg: ScormPackageRow, cmi: Record<string, string>): [string, string, number | null] {
  const num = (k: string) => (cmi[k] !== undefined && cmi[k] !== '' && !Number.isNaN(Number(cmi[k])) ? Number(cmi[k]) : null);
  if (pkg.runtime === 'scorm12') {
    const s = (cmi['cmi.core.lesson_status'] ?? 'not attempted').toLowerCase();
    const raw = num('cmi.core.score.raw');
    const min = num('cmi.core.score.min') ?? 0;
    const max = num('cmi.core.score.max') ?? 100;
    const scaled = raw !== null && max > min ? Math.max(-1, Math.min(1, (raw - min) / (max - min))) : null;
    const [completion, status12] =
      s === 'passed'
        ? ['completed', 'passed']
        : s === 'failed'
          ? ['completed', 'failed']
          : s === 'completed'
            ? ['completed', 'unknown']
            : s === 'incomplete' || s === 'browsed'
              ? ['incomplete', 'unknown']
              : ['not_attempted', 'unknown'];
    // With a mastery score, the LMS decides passed/failed from the raw score once the SCO is done.
    const success =
      pkg.masteryScore !== null && raw !== null && completion === 'completed' ? (raw >= pkg.masteryScore ? 'passed' : 'failed') : status12;
    return [completion, success, scaled];
  }
  const c = (cmi['cmi.completion_status'] ?? 'unknown').toLowerCase();
  let completion = c === 'completed' || c === 'incomplete' ? c : c === 'not attempted' ? 'not_attempted' : 'unknown';
  let success = ['passed', 'failed'].includes((cmi['cmi.success_status'] ?? '').toLowerCase())
    ? cmi['cmi.success_status']!.toLowerCase()
    : 'unknown';
  const scaled = num('cmi.score.scaled');
  if (pkg.masteryScore !== null && scaled !== null) success = scaled >= pkg.masteryScore / 100 ? 'passed' : 'failed';
  if (success === 'passed') completion = 'completed';
  return [completion, success, scaled];
}

/** Laravel's ScormRuntime::counts — what completes the lesson under the package's tracking. */
const counts = (pkg: ScormPackageRow, completion: string, success: string) =>
  pkg.tracking === 'Completion only'
    ? completion === 'completed' || success === 'passed'
    : success === 'passed' || (completion === 'completed' && success !== 'failed');

function complete(t: TenantData, user: UserRow, lessonId: string, courseId: string) {
  if (!t.completions.some((x) => x.userId === user.id && x.lessonId === lessonId)) {
    t.completions.push({ userId: user.id, lessonId, at: new Date().toISOString() });
    maybeIssueCertificate(t, user, courseId);
  }
}

function launchUrl(c: Context, t: TenantData, pkg: ScormPackageRow, lesson: LessonRow, user: UserRow) {
  const base = scormLaunchPath(pkg);
  if (pkg.runtime === 'scorm12' || pkg.runtime === 'scorm2004') return base;
  const claims = { t: t.site.slug, l: lesson.id, u: user.id };
  // The school's host (the proxy forwards it), so the AU talks to the LRS on its own origin.
  const host = c.req.header('x-forwarded-host');
  const origin = host ? `${c.req.header('x-forwarded-proto') ?? 'http'}://${host}` : new URL(c.req.url).origin;
  const endpoint = `${origin}/api/v1/xapi/`;
  const actor = JSON.stringify({ objectType: 'Agent', name: user.name, account: { homePage: origin, name: user.id } });
  const registration = id('reg');
  const q: Record<string, string> =
    pkg.runtime === 'cmi5'
      ? { endpoint, fetch: `${origin}/api/v1/xapi/fetch/${b64(claims)}`, registration, activityId: pkg.activityId, actor }
      : {
          endpoint,
          auth: `Basic ${Buffer.from(`coursiva:${b64(claims)}`).toString('base64')}`,
          actor,
          registration,
          activity_id: pkg.activityId,
        };
  return `${base}?${new URLSearchParams(q).toString()}`;
}

function scormLesson(c: AppContext) {
  const r = lessonFor(c);
  if ('error' in r) return r;
  if (!r.lesson.scorm) return { error: c.json({ message: 'This lesson has no SCORM package.' }, 404) };
  return { ...r, pkg: r.lesson.scorm };
}

/** Counts a launch. `cmi` (SCORM only) = saved elements + LMS-owned values. */
scormRoutes.get('/me/lessons/:id/scorm', (c: AppContext) => {
  const r = scormLesson(c);
  if ('error' in r) return r.error;
  const { t, user, lesson, pkg } = r;
  const a = ensureAttempt(t, user, lesson);
  a.launches += 1;
  const launch: ScormLaunch = {
    launchUrl: launchUrl(c, t, pkg, lesson, user),
    standard: pkg.standard,
    runtime: pkg.runtime,
    version: pkg.version,
    tracking: pkg.tracking,
    cmi: pkg.runtime === 'scorm12' || pkg.runtime === 'scorm2004' ? lmsValues(pkg, user, a) : null,
    state: scormState(a),
  };
  return ok(c, launch);
});

/** `{cmi: {"cmi.…": "value"}, finish?}` → `{completed, progress, state}`. */
scormRoutes.put('/me/lessons/:id/scorm', async (c: AppContext) => {
  const r = scormLesson(c);
  if ('error' in r) return r.error;
  const { t, user, course, lesson, pkg } = r;
  if (!isEnrolled(t, user, course.id)) return c.json({ message: 'Enrol to open this lesson.' }, 403);
  let raw: { cmi?: unknown; finish?: unknown };
  try {
    raw = await c.req.json();
  } catch {
    raw = {};
  }
  if (pkg.runtime !== 'scorm12' && pkg.runtime !== 'scorm2004')
    return invalid(c, { cmi: 'xAPI packages report through the LRS, not the SCORM runtime.' });
  if (!raw.cmi || typeof raw.cmi !== 'object' || Array.isArray(raw.cmi)) return invalid(c, { cmi: 'The cmi field is required.' });
  const entries = Object.entries(raw.cmi as Record<string, unknown>);
  if (entries.length > 500) return invalid(c, { cmi: 'Commit at most 500 elements at a time.' });
  const incoming: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (!/^cmi\.[A-Za-z0-9_.]{1,250}$/.test(k)) return invalid(c, { cmi: `Unknown data-model element ${k.slice(0, 60)}.` });
    if (v !== null && typeof v === 'object')
      return c.json({ message: 'Values must be strings.', errors: { [`cmi.${k}`]: ['Values must be strings.'] } }, 422);
    const s = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
    if (s.length > 64_000) return c.json({ message: 'The value is too long.', errors: { [`cmi.${k}`]: ['The value is too long.'] } }, 422);
    incoming[k] = s;
  }
  const a = ensureAttempt(t, user, lesson);
  for (const [k, v] of Object.entries(incoming)) if (!LMS_OWNED.has(k)) a.cmi[k] = v;
  if (Object.keys(a.cmi).length > 2000) return invalid(c, { cmi: 'The package saved too much data.' });
  const [completion, success, scaled] = status(pkg, a.cmi);
  const done = counts(pkg, completion, success);
  const session = incoming[pkg.runtime === 'scorm12' ? 'cmi.core.session_time' : 'cmi.session_time'];
  if (raw.finish === true && session) a.totalSeconds += sessionSeconds(session);
  Object.assign(a, { completionStatus: completion, successStatus: success, scoreScaled: scaled ?? a.scoreScaled });
  if (done && !a.completedAt) a.completedAt = new Date().toISOString();
  if (a.completedAt) complete(t, user, lesson.id, course.id);
  return ok(c, { completed: a.completedAt !== null, progress: progressOf(course, completedSet(t, user.id)), state: scormState(a) });
});

/* ------------------------------------------------------------------ package files */

const SCO_STYLE =
  'body{font:15px/1.5 system-ui,sans-serif;margin:24px;color:#1d1b26;background:#fff}h1{font-size:20px;margin:0 0 8px}' +
  'button{font:inherit;padding:8px 14px;margin:6px 8px 0 0;border:1px solid #6b5bd2;border-radius:8px;background:#fff;color:#3b2fa0;cursor:pointer}' +
  '#s{color:#555}';

function scoHtml(runtime: string, title: string) {
  const script =
    runtime === 'scorm12'
      ? `var api=window.parent&&window.parent.API,s=document.getElementById('s');
if(!api){s.textContent='No LMS found.'}else{api.LMSInitialize('');s.textContent='Hello '+api.LMSGetValue('cmi.core.student_name')+' — status: '+api.LMSGetValue('cmi.core.lesson_status');}
document.querySelectorAll('button[data-score]').forEach(function(b){b.onclick=function(){var n=b.getAttribute('data-score');
api.LMSSetValue('cmi.core.score.raw',n);api.LMSSetValue('cmi.core.score.min','0');api.LMSSetValue('cmi.core.score.max','100');
api.LMSSetValue('cmi.core.lesson_status','completed');api.LMSSetValue('cmi.core.session_time','0000:02:30.00');
api.LMSCommit('');api.LMSFinish('');s.textContent='Saved: score '+n+'.';};});`
      : runtime === 'scorm2004'
        ? `var api=window.parent&&window.parent.API_1484_11,s=document.getElementById('s');
if(!api){s.textContent='No LMS found.'}else{api.Initialize('');s.textContent='Hello '+api.GetValue('cmi.learner_name')+' — '+api.GetValue('cmi.completion_status');}
document.querySelectorAll('button[data-score]').forEach(function(b){b.onclick=function(){
api.SetValue('cmi.completion_status','completed');api.SetValue('cmi.score.scaled',b.getAttribute('data-score')/100+'');
api.SetValue('cmi.session_time','PT2M30S');api.Commit('');api.Terminate('');s.textContent='Saved.';};});`
        : `var q=new URLSearchParams(location.search),s=document.getElementById('s');s.textContent='Ready ('+(q.get('registration')||'preview')+')';
document.querySelectorAll('button[data-score]').forEach(function(b){b.onclick=function(){if(!q.get('fetch')){s.textContent='Preview — nothing is saved.';return;}
fetch(q.get('fetch'),{method:'POST'}).then(function(r){return r.json()}).then(function(j){
return fetch(q.get('endpoint')+'statements',{method:'POST',headers:{'Content-Type':'application/json','X-Experience-API-Version':'1.0.3',Authorization:'Basic '+j['auth-token']},
body:JSON.stringify({actor:JSON.parse(q.get('actor')),verb:{id:'http://adlnet.gov/expapi/verbs/completed'},object:{id:q.get('activityId')},result:{completion:true}})});
}).then(function(){s.textContent='Completed — reported to the LRS.';});};});`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${SCO_STYLE}</style></head>
<body><h1>${title}</h1><p id="s">Connecting…</p><p>A funnel gets 1,000 visitors, 400 opt-ins and 12 sales. Which step leaks most?</p>
<button data-score="100">Checkout</button><button data-score="40">Landing page</button>
<script>${script}</script></body></html>`;
}

/** Stateless (no session): the token names the package. Laravel's headers, so the SCO can only frame on the school's own origin. */
scormRoutes.get('/files/scorm/:token/*', (c: AppContext) => {
  const claims = unb64(c.req.param('token') ?? '');
  const pkg = claims
    ? c
        .get('t')
        .courses.flatMap((x) => x.modules.flatMap((m) => m.lessons))
        .find((l) => l.scorm?.id === claims.p)?.scorm
    : undefined;
  if (!pkg) return notFound(c, 'File');
  const title = { scp_sim: 'Funnel simulator', scp_offer: 'Offer builder', scp_pitch: 'Pitch practice' }[pkg.id] ?? 'Package';
  return c.body(scoHtml(pkg.runtime, title), 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy':
      "sandbox allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads; frame-ancestors 'self'",
  });
});

/* ------------------------------------------------------------------ xAPI LRS (stateless; Basic auth) */

export const xapiRoutes = new Hono<Env>();
xapiRoutes.use('*', withTenant);
xapiRoutes.use('*', async (c, next) => {
  await next();
  c.header('X-Experience-API-Version', '1.0.3');
});

/** cmi5: single-use fetch → `{"auth-token"}` (the AU sends it as Basic credentials). */
xapiRoutes.post('/fetch/:token', (c: AppContext) => {
  const claims = unb64(c.req.param('token') ?? '');
  if (!claims) return c.json({ 'error-code': '3', 'error-text': 'Invalid token.' }, 400);
  return c.json({ 'auth-token': Buffer.from(`coursiva:${b64(claims)}`).toString('base64') });
});

xapiRoutes.get('/about', (c) => c.json({ version: ['1.0.3'] }));

xapiRoutes.post('/statements', async (c: AppContext) => {
  const t = c.get('t');
  const header = c.req.header('authorization') ?? '';
  const decoded = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString('utf8') : '';
  const claims = decoded.startsWith('coursiva:') ? unb64(decoded.slice(9)) : null;
  const found = claims && claims.t === t.site.slug ? findLesson(t, claims.l ?? '') : null;
  const user = found ? t.users.find((u) => u.id === claims!.u) : undefined;
  if (!found?.lesson.scorm || !user) return c.json({ message: 'Unauthenticated.' }, 401);
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    raw = null;
  }
  const list = (Array.isArray(raw) ? raw : [raw]).slice(0, 50) as {
    verb?: { id?: string };
    object?: { id?: string };
    result?: { completion?: boolean; success?: boolean };
  }[];
  const pkg = found.lesson.scorm;
  const a = ensureAttempt(t, user, found.lesson);
  for (const s of list) {
    // Only statements about the package's own activity complete the lesson.
    if (s?.object?.id !== pkg.activityId) continue;
    const verb = (s.verb?.id ?? '').split('/').at(-1) ?? '';
    if (['completed', 'passed', 'mastered'].includes(verb) || s.result?.completion === true) a.completionStatus = 'completed';
    if (verb === 'passed' || verb === 'mastered' || s.result?.success === true) a.successStatus = 'passed';
    if (verb === 'failed' || s.result?.success === false) a.successStatus = 'failed';
  }
  if (counts(pkg, a.completionStatus ?? '', a.successStatus ?? '') && !a.completedAt) a.completedAt = new Date().toISOString();
  if (a.completedAt) complete(t, user, found.lesson.id, found.course.id);
  return c.json(list.map(() => crypto.randomUUID()));
});
