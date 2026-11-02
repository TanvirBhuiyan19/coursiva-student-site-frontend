/**
 * Site builder output on the school's host (Laravel's PublicSiteController + PublicPageActionsController): `GET /site`
 * with the builder chrome and lock state, `GET /pages/{slug}` (multi-segment), page/site unlocks, builder forms and
 * the published site images. Contract: docs/api/pages.md, docs/api/tenant.md.
 */
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppContext, Env } from '../lib/db';
import { apiError, body, id, invalid, notFound, ok } from '../lib/http';
import {
  type BDoc,
  LABELS,
  SITE_COOKIE,
  SLUG,
  builderContext,
  chrome,
  formFields,
  isMember,
  liveDoc,
  pageCookie,
  pageFor,
  resolvePage,
  unlockToken,
} from '../lib/sitebuilder';

export const siteRoutes = new Hono<Env>();

const COOKIE_DAYS = 30;
const NO_STORE = 'private, no-store';

/** A valid `?preview=` token (a dashboard preview link): the draft, any page, no lock. */
const isPreview = (c: AppContext) => {
  const token = c.req.query('preview');
  return typeof token === 'string' && c.get('t').builder.previewTokens.includes(token);
};

function lockState(c: AppContext, doc: BDoc = liveDoc(c.get('t'))) {
  const t = c.get('t');
  const enabled = doc.settings.siteLock;
  const password = doc.settings.sitePassword;
  const cookie = getCookie(c, SITE_COOKIE);
  const unlocked = !enabled || isPreview(c) || (password !== '' && cookie === unlockToken('site', t.site.slug, '', password));
  return { enabled, unlocked, password: password !== '' };
}

/**
 * EnsureSiteUnlocked: public storefront reads answer `401 site_locked` while the site is locked for this visitor;
 * while the lock is on, answers depend on the cookie and are never cached. Returns the error response, or null.
 */
export function siteLocked(c: AppContext): Response | null {
  const lock = lockState(c);
  if (lock.enabled) c.header('Cache-Control', NO_STORE);
  return lock.unlocked ? null : apiError(c, 401, LABELS.errors.siteLocked, 'site_locked');
}

siteRoutes.get('/site', (c: AppContext) => {
  const t = c.get('t');
  const preview = isPreview(c);
  const doc = preview ? t.builder.draft : liveDoc(t);
  // The lock follows what is live (a preview is always unlocked).
  const lock = lockState(c);
  if (preview || lock.enabled) c.header('Cache-Control', NO_STORE);
  const home = doc.pages.find((p) => p.slug === '/');
  const auth = doc.pages.find((p) => p.slug === '/login' || p.slug === '/sign-in')?.sections.find((s) => s.kind === 'auth');
  // Platform feature availability, applied the way the API applies it: sign-in providers, SSO and features follow it.
  const unavailable = t.unavailable ?? [];
  const on = (capability: string) => !unavailable.includes(capability);
  return ok(c, {
    ...t.site,
    unavailable,
    oauthProviders: t.site.oauthProviders.filter((p) => on(`signin_${p}`)),
    ssoEnabled: t.site.ssoEnabled === true && on('sso'),
    features: {
      ...t.site.features,
      membership: t.site.features.membership && on('memberships'),
      community: t.site.features.community && on('community'),
      certificates: t.site.features.certificates && on('certs'),
    },
    social: doc.settings.social.length ? doc.settings.social.filter((l) => l.url !== '') : t.site.social,
    seo: {
      ...t.site.seo,
      title: home?.seoTitle || t.site.seo.title,
      description: home?.seoDescription || t.site.seo.description,
      indexable: t.site.seo.indexable && !lock.enabled,
      ogImageUrl: doc.settings.shareImage?.url ?? t.site.seo.ogImageUrl,
    },
    authPitch: auth
      ? {
          title: auth.txt.tagline || LABELS.learnWith(t.site.name),
          bullets: auth.items.filter((i) => i.on && i.a !== '').map((i) => i.a),
          quote: auth.txt.quote ? { text: auth.txt.quote, author: auth.txt.quote_by ?? '', rating: 5 } : null,
        }
      : t.site.authPitch,
    ...chrome(t, doc, preview),
    // Tag ids and verification tokens: never on a preview (as the API).
    tracking: preview ? null : t.site.tracking,
    siteLock: lock,
    pages: doc.pages
      .filter((p) => !p.template && p.visibility === 'Public' && p.slug !== '/')
      .map((p) => ({ path: p.slug, title: p.title })),
  });
});

siteRoutes.post('/site/unlock', async (c: AppContext) => {
  const t = c.get('t');
  const settings = liveDoc(t).settings;
  if (!settings.siteLock || settings.sitePassword === '') return notFound(c, 'Site');
  const { password } = await body<{ password: string }>(c);
  if (typeof password !== 'string' || password !== settings.sitePassword) return invalid(c, { password: LABELS.errors.wrongPassword });
  setCookie(c, SITE_COOKIE, unlockToken('site', t.site.slug, '', settings.sitePassword), {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: COOKIE_DAYS * 86400,
  });
  c.header('Cache-Control', NO_STORE);
  return ok(c, { unlocked: true });
});

/** Page visibility for this visitor (a preview sees every page). Returns the error response, or null. */
function pageAccess(c: AppContext, p: ReturnType<typeof pageFor> & object, preview: boolean): Response | null {
  if (preview) return null;
  const t = c.get('t');
  if (p.visibility === 'Password') {
    if (getCookie(c, pageCookie(p.id)) !== unlockToken('page', t.site.slug, p.id, p.password))
      return apiError(c, 401, LABELS.errors.pagePassword, 'page_password_required', { title: p.title });
  } else if (p.visibility === 'Members only') {
    const user = c.get('user');
    if (!user) return apiError(c, 401, LABELS.errors.membersSignIn, 'members_only');
    if (!isMember(t, user.id)) return apiError(c, 403, LABELS.errors.membersOnly, 'members_only');
  }
  return null;
}

const slugOf = (rest: string) => {
  const slug = decodeURIComponent(rest);
  return SLUG.test(slug) && slug.length <= 200 ? slug : null;
};

siteRoutes.get('/pages/*', (c: AppContext) => {
  const t = c.get('t');
  const slug = slugOf(c.req.path.replace(/^\/api\/v1\/pages\//, ''));
  const preview = isPreview(c);
  if (!preview) {
    const locked = siteLocked(c);
    if (locked) return locked;
  }
  const doc = preview ? t.builder.draft : liveDoc(t);
  const p = slug === null ? null : pageFor(doc, slug);
  if (!p || slug === null) return apiError(c, 404, LABELS.errors.pageNotFound, 'not_found');
  const denied = pageAccess(c, p, preview);
  if (denied) return denied;
  const updated = preview ? t.builder.draftUpdatedAt : (t.builder.publishedAt ?? '2026-01-01T00:00:00Z');
  const personal = preview || p.visibility !== 'Public' || lockState(c).enabled;
  if (personal) c.header('Cache-Control', NO_STORE);
  return ok(c, resolvePage(t, doc, p, slug, updated));
});

siteRoutes.post('/pages/*', async (c: AppContext) => {
  const t = c.get('t');
  const rest = c.req.path.replace(/^\/api\/v1\/pages\//, '');
  const unlock = /^(.+)\/unlock$/.exec(rest);
  const form = /^(.+)\/forms\/([A-Za-z0-9_-]{1,40})$/.exec(rest);
  const slug = slugOf((unlock ?? form)?.[1] ?? '');
  if (slug === null) return apiError(c, 404, LABELS.errors.pageNotFound, 'not_found');
  const locked = siteLocked(c);
  if (locked) return locked;
  const doc = liveDoc(t);
  const p = pageFor(doc, slug);

  if (unlock) {
    if (!p || p.visibility !== 'Password') return apiError(c, 404, LABELS.errors.pageNotFound, 'not_found');
    const { password } = await body<{ password: string }>(c);
    if (typeof password !== 'string' || password === '' || password !== p.password)
      return invalid(c, { password: LABELS.errors.wrongPassword });
    setCookie(c, pageCookie(p.id), unlockToken('page', t.site.slug, p.id, p.password), {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: COOKIE_DAYS * 86400,
    });
    c.header('Cache-Control', NO_STORE);
    return ok(c, { unlocked: true });
  }

  if (!p) return apiError(c, 404, LABELS.errors.pageNotFound, 'not_found');
  const denied = pageAccess(c, p, false);
  if (denied) return denied;
  const section = p.sections.find((s) => s.id === form![2] && s.kind === 'form' && !s.hide && (s.set.desk || s.set.mob));
  const ctx = builderContext(t, doc);
  const fields = section ? formFields(ctx, section) : [];
  if (!section || fields.length === 0) return apiError(c, 404, LABELS.errors.formNotFound, 'not_found');

  // Raw body: field ids are data keys (`f1`), so no case conversion is needed or wanted.
  const raw: { values?: unknown; website?: unknown } = await c.req.json<{ values?: unknown; website?: unknown }>().catch(() => ({}));
  // A filled honeypot is a bot: answer like a success, store nothing.
  if (typeof raw.website === 'string' && raw.website.trim() !== '') return ok(c, { received: true }, 201);
  const values = raw.values !== null && typeof raw.values === 'object' ? (raw.values as Record<string, unknown>) : {};
  const errors: Record<string, string> = {};
  const answers: { id: string; label: string; type: string; value: string | boolean }[] = [];
  for (const f of fields) {
    const v = values[f.id];
    const key = `values.${f.id}`;
    if (f.type === 'checkbox') {
      const checked = v === true || v === 'true' || v === '1' || v === 1;
      if (f.required && !checked) errors[key] = LABELS.form.checkbox;
      answers.push({ id: f.id, label: f.label, type: f.type, value: checked });
      continue;
    }
    const value = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
    const max = f.type === 'long_text' ? 5000 : f.type === 'email' ? 254 : 500;
    const error =
      value === ''
        ? f.required
          ? LABELS.form.required
          : null
        : value.length > max
          ? LABELS.form.max(max)
          : f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
            ? LABELS.form.email
            : f.type === 'phone' && !/^\+?[0-9 ().-]{5,30}$/.test(value)
              ? LABELS.form.phone
              : f.type === 'choice' && f.options.length > 0 && !f.options.includes(value)
                ? LABELS.form.choice
                : null;
    if (error) errors[key] = error;
    answers.push({ id: f.id, label: f.label, type: f.type, value: f.type === 'email' ? value.toLowerCase() : value });
  }
  if (Object.keys(errors).length) {
    // Field keys (`values.f2`) must reach the client untouched.
    return c.json({ message: Object.values(errors)[0], errors: Object.fromEntries(Object.entries(errors).map(([k, m]) => [k, [m]])) }, 422);
  }
  const email = answers.find((a) => a.type === 'email' && a.value !== '');
  if (section.opt.save !== false && email && typeof email.value === 'string') {
    const nameAnswer = answers.find((a) => a.type === 'text' && /\bname\b/i.test(a.label) && a.value !== '');
    if (!t.builder.contacts.some((x) => x.email === email.value))
      t.builder.contacts.push({
        email: email.value,
        name: typeof nameAnswer?.value === 'string' ? nameAnswer.value : null,
        source: 'Website form',
        tag: 'Lead',
      });
  }
  t.builder.submissions.push({ id: id('sfs'), pageId: p.id, sectionId: section.id, values: answers, createdAt: new Date().toISOString() });
  return ok(c, { received: true }, 201);
});

/** A 1×1 PNG: the mock's stand-in for published site images (favicon, share image). */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAEhwGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

siteRoutes.get('/site/assets/:asset', (c: AppContext) => {
  const doc = liveDoc(c.get('t'));
  const asset = c.req.param('asset');
  if (doc.settings.favicon?.assetId !== asset && doc.settings.shareImage?.assetId !== asset) return notFound(c, 'Image');
  return c.body(PIXEL, 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=300' });
});
