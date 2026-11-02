/** Public, cacheable reads (the storefront) plus the two anonymous writes (newsletter, support ticket). */
import { Hono } from 'hono';
import type { Catalog, CoursePreview, LessonFormat } from '@/features/catalog/types';
import type { ProductPage } from '@/features/commerce/types';
import type { Membership } from '@/features/membership/types';
import type { HelpArticle, HelpCategory, HelpSearchResult, LegalDocument, SupportTicketInput } from '@/features/account/types';
import type { AppContext, Env } from '../lib/db';
import { PASS_PERCENT, videoBlock } from '../lib/assessment';
import { presentBlocks } from '../lib/blocks';
import { apiError, body, id, invalid, isEmail, notFound, ok, paginate, str } from '../lib/http';
import {
  courseDetail,
  courseSummary,
  instructorDetail,
  instructorSummary,
  membershipPlans,
  money,
  previewLessons,
  visibleProfile,
} from '../lib/present';
import { sellableService, servicePage } from '../lib/bookings';
import { siteLocked } from './site';
import type { TenantData } from '../lib/records';
import { ACTIVE_PARTNERS, affiliateProgram } from '../lib/affiliates';

export const publicRoutes = new Hono<Env>();

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function categories(t: TenantData) {
  return t.categories.map((cat) => ({ ...cat, courseCount: t.courses.filter((x) => x.categorySlug === cat.slug).length }));
}

publicRoutes.get('/courses', (c: AppContext) => {
  const locked = siteLocked(c);
  if (locked) return locked;
  const t = c.get('t');
  const catalog: Catalog = {
    courses: [...t.courses].sort((a, b) => b.studentCount - a.studentCount).map((x) => courseSummary(t, x)),
    categories: categories(t),
    bundles: t.bundles.map((b) => {
      const compare = b.courseSlugs.reduce((a, s) => a + (t.courses.find((x) => x.slug === s)?.price ?? 0), 0);
      return {
        ...b,
        price: money(t, b.price),
        compareAtPrice: money(t, compare),
        savingsPercent: Math.round(((compare - b.price) / compare) * 100),
      };
    }),
  };
  return ok(c, catalog);
});

publicRoutes.get('/courses/:slug', (c: AppContext) => {
  const locked = siteLocked(c);
  if (locked) return locked;
  const t = c.get('t');
  const row = t.courses.find((x) => x.slug === c.req.param('slug'));
  return row ? ok(c, courseDetail(t, row)) : notFound(c, 'Course');
});

/**
 * A free-preview lesson as a guest gets it (Laravel `CoursePreviewController` + `GuestPreview`): `?lesson=` picks one
 * of the course's free previews (none: the first); any other lesson is the same 404. For anyone who may see the
 * course — no session needed (a session is ignored), same tenant and site-lock rules as the course page. Never cached
 * (signed URLs). By format: a video (the lesson block without a watermark; the mock has no media files, so only seeded
 * embeds play — any other video answers 404), the blocks up to the first gate, a PDF in the inline viewer, a quiz's or
 * live lesson's summary (never its questions or answers).
 */
const NO_PREVIEW = 'This course has no preview.';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

publicRoutes.get('/courses/:slug/preview', (c: AppContext) => {
  c.header('Cache-Control', 'private, no-store');
  const locked = siteLocked(c);
  if (locked) return locked;
  const t = c.get('t');
  const course = t.courses.find((x) => x.slug === c.req.param('slug'));
  if (!course) return apiError(c, 404, NO_PREVIEW, 'not_found');
  const wanted = c.req.queries('lesson')?.at(-1) ?? '';
  const isArray = Object.keys(c.req.queries()).some((k) => k.startsWith('lesson['));
  const list = previewLessons(course);
  const lesson = isArray ? undefined : wanted === '' ? list[0] : list.find((l) => l.id === wanted);
  if (!lesson) return apiError(c, 404, NO_PREVIEW, 'not_found');
  const format: LessonFormat = lesson.scorm ? 'scorm' : lesson.assignment ? 'assignment' : lesson.survey ? 'survey' : lesson.type;
  const video = lesson.type === 'video' ? videoBlock(t, null, lesson) : null;
  // Nothing playable (no transcode, no file, no embed): no preview — never an empty player.
  if (video && video.hlsUrl === null && video.url === null && video.embedUrl === null) return apiError(c, 404, NO_PREVIEW, 'not_found');
  // Up to the first continue gate only (no learner: every gate is unpassed, interactive blocks have no state).
  const blocks = presentBlocks(t, lesson.id, null);
  const summary =
    lesson.type === 'quiz' || lesson.type === 'live' || format === 'assignment' || format === 'scorm' || format === 'survey'
      ? {
          kind: format,
          questionCount: lesson.type === 'quiz' ? lesson.questions.length : null,
          passPercent: lesson.type === 'quiz' ? PASS_PERCENT : null,
          timeLimitMinutes: null,
          attemptsAllowed: lesson.assignment?.attempts ?? null,
          points: lesson.assignment?.points ?? null,
          startsAt: lesson.live?.startsAt ?? null,
          durationMinutes: lesson.live?.durationMin ?? null,
        }
      : null;
  const preview: CoursePreview = {
    lessonId: lesson.id,
    title: lesson.title,
    type: lesson.type,
    format,
    durationSeconds: lesson.durationSeconds,
    posterUrl: video?.posterUrl ?? null,
    video,
    ...blocks,
    // The mock has no authored Markdown: a text lesson without blocks reads its description; a survey its intro. An
    // assignment's brief is gated (never sent).
    bodyHtml:
      format === 'survey'
        ? `<p>${escapeHtml(lesson.survey!.intro)}</p>`
        : format === 'text' && blocks.blocks === null
          ? '<p>In this lesson you will work through the concept step by step, see it applied to a real student business, and leave with one action to complete before the next lesson.</p>'
          : null,
    pdf:
      lesson.type === 'pdf'
        ? {
            url: `/api/v1/courses/${course.slug}/preview/files/${lesson.id}`,
            name: `${lesson.title}.pdf`,
            sizeBytes: lesson.pdfSizeBytes ?? 0,
            downloadable: true,
          }
        : null,
    file: null,
    link: null,
    resources: [],
    summary,
    course: { slug: course.slug, title: course.title },
  };
  return ok(c, preview);
});

/** The mock's stand-in for a signed inline PDF URL of a free-preview PDF lesson (a one-page PDF). */
const PREVIEW_PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';

publicRoutes.get('/courses/:slug/preview/files/:lesson', (c: AppContext) => {
  c.header('Cache-Control', 'private, no-store');
  const course = c.get('t').courses.find((x) => x.slug === c.req.param('slug'));
  const lesson = course && previewLessons(course).find((l) => l.id === c.req.param('lesson') && l.type === 'pdf');
  if (!lesson) return apiError(c, 404, 'Not found.', 'not_found');
  c.header('Content-Type', 'application/pdf');
  c.header('Content-Disposition', 'inline; filename="preview.pdf"');
  return c.body(PREVIEW_PDF);
});

/**
 * A product's sales page (Laravel `PublicProductController`): a published digital download or a bundle; anything
 * else is 404.
 */
publicRoutes.get('/products/:slug', (c: AppContext) => {
  const locked = siteLocked(c);
  if (locked) return locked;
  const t = c.get('t');
  const slug = c.req.param('slug');
  const d = (t.products ?? []).find((p) => p.slug === slug);
  if (d) {
    const page: ProductPage = {
      slug: d.slug,
      kind: 'download',
      title: d.title,
      description: d.description,
      // Laravel: the dashboard-uploaded thumbnail (the mock seeds none).
      thumbnailUrl: null,
      price: money(t, d.price),
      compareAtPrice: null,
      file: { name: d.fileName, sizeMb: d.sizeMb },
      delivery: { linkExpiryDays: d.linkExpiryDays, downloadLimit: d.downloadLimit },
      courses: [],
      service: null,
    };
    return ok(c, page);
  }
  // A published service with an active host (1:1 sessions: pick a time, then book).
  const service = sellableService(t, slug ?? '');
  if (service) return ok(c, servicePage(t, service));
  const b = t.bundles.find((x) => x.slug === slug);
  const courses = (b?.courseSlugs ?? []).flatMap((s) => {
    const row = t.courses.find((x) => x.slug === s);
    return row ? [row] : [];
  });
  if (!b || !courses.length) return notFound(c, 'Product');
  const compare = courses.reduce((a, x) => a + x.price, 0);
  const page: ProductPage = {
    slug: b.slug,
    kind: 'bundle',
    title: b.title,
    description: b.description,
    thumbnailUrl: null,
    price: money(t, b.price),
    compareAtPrice: compare > b.price ? money(t, compare) : null,
    file: null,
    delivery: null,
    courses: [...courses].sort((x, y) => x.title.localeCompare(y.title)).map((x) => ({ slug: x.slug, title: x.title })),
    service: null,
  };
  return ok(c, page);
});

/**
 * Public certificate verification (Laravel's tenant-less registry). Revoked certificates still answer, with their
 * status; unknown codes are 404 like Laravel's.
 */
publicRoutes.get('/registry/certificates/:code', (c: AppContext) => {
  const t = c.get('t');
  const cert = t.certificates.find((x) => x.id === c.req.param('code'));
  const course = cert && t.courses.find((x) => x.id === cert.courseId);
  const holder = cert && t.users.find((u) => u.id === cert.userId);
  if (!cert || !course || !holder) return c.json({ message: 'No certificate matches this code.' }, 404);
  return ok(c, {
    code: cert.id,
    url: `https://${t.site.primaryHost}/verify/${cert.id}`,
    status: cert.revoked ? 'revoked' : 'valid',
    holderName: holder.name,
    courseTitle: course.title,
    issuerName: t.site.name,
    issuedAt: cert.issuedAt,
    expiresAt: null,
    reissuedAt: null,
    revokedAt: cert.revoked ? cert.issuedAt : null,
  });
});

/* The school's blog (Laravel PublicBlogController): published posts, newest first; views and moderated comments. */
const blogCard = (p: NonNullable<TenantData['blog']>[number]) => ({
  slug: p.slug,
  title: p.title,
  excerpt: p.excerpt,
  publishedAt: p.publishedAt,
  categories: p.categories,
  author: { name: p.author },
  readMinutes: Math.max(1, Math.round(p.body.split(/\s+/).length / 200)),
  hasCover: false,
});

publicRoutes.get('/blog/posts', (c: AppContext) => {
  const locked = siteLocked(c);
  if (locked) return locked;
  const posts = [...(c.get('t').blog ?? [])].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map(blogCard);
  return paginate(c, posts, Math.min(50, Math.max(1, Number(c.req.query('per_page') ?? 12) || 12)));
});

publicRoutes.get('/blog/posts/:slug', (c: AppContext) => {
  const locked = siteLocked(c);
  if (locked) return locked;
  const p = (c.get('t').blog ?? []).find((x) => x.slug === c.req.param('slug'));
  if (!p) return notFound(c, 'Post');
  return ok(c, { ...blogCard(p), body: p.body, seo: { title: p.title, description: p.excerpt }, cta: 'course', comments: p.comments });
});

publicRoutes.post('/blog/posts/:slug/views', (c: AppContext) => {
  if (!(c.get('t').blog ?? []).some((x) => x.slug === c.req.param('slug'))) return notFound(c, 'Post');
  return c.body(null, 204);
});

publicRoutes.post('/blog/posts/:slug/comments', async (c: AppContext) => {
  if (!(c.get('t').blog ?? []).some((x) => x.slug === c.req.param('slug'))) return notFound(c, 'Post');
  const b = await body<{ name: string; email: string; text: string }>(c);
  if (!str(b.name)) return invalid(c, { name: 'Add your name.' });
  if (!isEmail(str(b.email))) return invalid(c, { email: 'Enter a valid email address.' });
  if (str(b.text).length < 2 || str(b.text).length > 2000) return invalid(c, { text: 'Write a comment (2,000 characters max).' });
  return c.json({ data: { received: true } }, 202);
});

/*
 * Instructor profiles (Laravel PublicInstructorController, docs/api/instructors.md): only published profiles of active
 * members who can teach; everything else — unknown, draft, hidden, a former slug — is a plain 404.
 */
publicRoutes.get('/instructors', (c: AppContext) => {
  const locked = siteLocked(c);
  if (locked) return locked;
  const t = c.get('t');
  const dir = c.req.query('sort') === '-name' ? -1 : 1;
  const rows = (t.instructorProfiles ?? [])
    .filter((p) => visibleProfile(t, p.slug))
    .sort((a, b) => dir * a.name.localeCompare(b.name))
    .map((p) => instructorSummary(t, p));
  return paginate(c, rows, Math.min(100, Math.max(1, Number(c.req.query('per_page') ?? 25) || 25)));
});

publicRoutes.get('/instructors/:slug', (c: AppContext) => {
  const locked = siteLocked(c);
  if (locked) return locked;
  const t = c.get('t');
  const slug = c.req.param('slug') ?? '';
  const p = /^[a-z0-9-]{1,80}$/.test(slug) ? visibleProfile(t, slug) : null;
  return p ? ok(c, instructorDetail(t, p)) : notFound(c, 'Instructor');
});

/**
 * Former addresses (Laravel RedirectResolver): the school's SEO redirects win, then renamed profiles' old slugs → the
 * current one while that profile is visible. `404` when nothing claims the path.
 */
publicRoutes.get('/redirects/resolve', (c: AppContext) => {
  const locked = siteLocked(c);
  if (locked) return locked;
  const t = c.get('t');
  const path = c.req.query('path') ?? '';
  const former = /^\/instructors\/([a-z0-9-]{1,80})$/.exec(path)?.[1];
  const p = former ? (t.instructorProfiles ?? []).find((x) => x.formerSlugs.includes(former)) : undefined;
  if (p && visibleProfile(t, p.slug)) return ok(c, { to: `/instructors/${p.slug}`, status: 301 });
  return c.json({ message: 'No redirect.' }, 404);
});

/* The partner program (Laravel PublicAffiliateController): public terms and applications. */
publicRoutes.get('/affiliates/program', (c: AppContext) => {
  const t = c.get('t');
  const p = affiliateProgram(t);
  const fixed = p.commissionType === 'fixed';
  return ok(c, {
    school: t.site.name,
    rate: fixed ? 0 : 20,
    commissionType: p.commissionType,
    fixedAmount: fixed ? money(t, p.fixedAmount) : null,
    tiers: fixed
      ? null
      : [
          { name: 'Starter', rate: 20, rule: 'Everyone starts here' },
          { name: 'Pro', rate: 30, rule: '10+ sales a month' },
        ],
    cookieDays: p.cookieDays,
    recurring: p.recurring,
    recurringMonths: p.recurringMonths,
    refundHoldDays: 30,
    minPayout: money(t, 5000),
    // Laravel: the hosted partner assets with their public download link (`/api/v1/affiliates/assets/{id}`).
    assets: [
      {
        id: 'aas_banner',
        name: 'Course banner 1200×628.png',
        meta: 'PNG · 240 KB',
        url: `${new URL(c.req.url).origin}/api/v1/affiliates/assets/aas_banner`,
      },
    ],
  });
});

publicRoutes.post('/affiliates/applications', async (c: AppContext) => {
  const b = await body<{ name: string; email: string; pitch: string }>(c);
  if (str(b.name).length < 2) return invalid(c, { name: 'Add your name.' });
  const email = str(b.email).toLowerCase();
  if (!isEmail(email)) return invalid(c, { email: 'Enter a valid email address.' });
  if (email === 'taken@example.com') return invalid(c, { email: 'You’ve already applied with this email.' });
  return ok(c, { status: 'pending', link: null }, 201);
});

/**
 * A partner link's visit (`?ref=`), Laravel Referrals::click: records the click and answers its id with the program's
 * cookie window and attribution rule. Unknown or inactive partners are 404; the mock knows `maya`.
 */
publicRoutes.post('/affiliates/:slug/clicks', (c: AppContext) => {
  const t = c.get('t');
  const slug = str(c.req.param('slug')).trim().toLowerCase();
  if (!ACTIVE_PARTNERS.has(slug)) return notFound(c, 'Partner');
  const click = { id: id('afc'), partner: slug, at: Date.now() };
  (t.affiliateClicks ??= []).push(click);
  const p = affiliateProgram(t);
  return ok(c, { clickId: click.id, cookieDays: p.cookieDays, attribution: p.attribution }, 201);
});

/** SMS short links of the mock (Laravel sms_link_codes → sms_links.url). */
const SHORT_LINKS = new Map([['Sms0Demo1', 'https://example.com/spring-sale']]);

/**
 * `GET /l/{code}` (Laravel ShortLinkController): 302 to the link's destination (no-store, no referrer, noindex); an
 * unknown code is a 404 page. The mock doesn't count clicks.
 */
publicRoutes.get('/l/:code', (c: AppContext) => {
  const to = SHORT_LINKS.get(str(c.req.param('code')));
  if (!to) return c.html('<!doctype html><title>This link isn’t valid</title><h1>This link isn’t valid</h1>', 404);
  return c.body(null, 302, {
    Location: to,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex',
  });
});

publicRoutes.get('/membership', (c: AppContext) => {
  const locked = siteLocked(c);
  if (locked) return locked;
  const t = c.get('t');
  if (!t.site.features.membership) return notFound(c, 'Membership');
  const m: Membership = { ...t.membership, plans: membershipPlans(t) };
  return ok(c, m);
});

/** Help centre (docs/api/account.md → Help centre): the seed's articles, with bodies, related articles and search. */
const HELP_UPDATED = '2026-08-01T00:00:00Z';

/** Plain text of the first ~160 characters of Markdown — the API's `excerpt` rule (Laravel HelpCentre::excerpt). */
export function helpExcerpt(md: string): string {
  const text = md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-+]|\d+\.)\s+/gm, '')
    .replace(/[#*_>`\\]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(text);
  if (chars.length <= 160) return text;
  let cut = chars.slice(0, 157).join('');
  const space = cut.lastIndexOf(' ');
  if (space > 100) cut = cut.slice(0, space);
  return `${cut.replace(/[ ,.;:-]+$/, '')}…`;
}

function helpArticles(t: TenantData) {
  return t.help.flatMap((h) =>
    h.articles.map((a) => {
      const title = typeof a === 'string' ? a : a.title;
      const body =
        typeof a === 'string'
          ? `Here’s how to ${title.charAt(0).toLowerCase()}${title.slice(1)} at ${t.site.name}.\n\n## Step by step\n\n1. Sign in to your account.\n2. Open **Account** from the menu.\n3. Follow the steps on screen.\n\nStill stuck? [Contact us](/contact) and we’ll help.`
          : a.body;
      return { category: h.title, slug: slugify(title), title, body };
    }),
  );
}

publicRoutes.get('/help', (c: AppContext) => {
  const t = c.get('t');
  const cats: HelpCategory[] = [];
  for (const a of helpArticles(t)) {
    let cat = cats.find((x) => x.title === a.category);
    if (!cat) cats.push((cat = { title: a.category, articles: [] }));
    cat.articles.push({ slug: a.slug, title: a.title, excerpt: helpExcerpt(a.body) });
  }
  return ok(c, cats);
});

publicRoutes.get('/help/search', (c: AppContext) => {
  const words = [
    ...new Set(
      (c.req.query('q') ?? '')
        .slice(0, 100)
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 2),
    ),
  ].slice(0, 8);
  if (!words.length) return ok(c, [] as HelpSearchResult[]);
  const matches = helpArticles(c.get('t')).filter((a) => words.every((w) => `${a.title}\n${a.body}`.toLowerCase().includes(w)));
  const inTitle = (a: { title: string }) => words.every((w) => a.title.toLowerCase().includes(w));
  const hits: HelpSearchResult[] = [...matches.filter(inTitle), ...matches.filter((a) => !inTitle(a))]
    .slice(0, 20)
    .map((a) => ({ slug: a.slug, title: a.title, category: a.category, excerpt: helpExcerpt(a.body) }));
  return ok(c, hits);
});

publicRoutes.get('/help/articles/:slug', (c: AppContext) => {
  const all = helpArticles(c.get('t'));
  const a = all.find((x) => x.slug === c.req.param('slug'));
  if (!a) return notFound(c, 'Article');
  const article: HelpArticle = {
    ...a,
    excerpt: helpExcerpt(a.body),
    updatedAt: HELP_UPDATED,
    related: all
      .filter((x) => x.category === a.category && x.slug !== a.slug)
      .slice(0, 5)
      .map((x) => ({ slug: x.slug, title: x.title })),
  };
  return ok(c, article);
});

publicRoutes.get('/legal/:doc', (c: AppContext) => {
  const slug = c.req.param('doc');
  if (slug !== 'refund' && slug !== 'privacy' && slug !== 'terms') return notFound(c, 'Document');
  const d = c.get('t').legal[slug];
  const doc: LegalDocument = { slug, title: d.title, updatedAt: d.updatedAt, sections: d.sections };
  return ok(c, doc);
});

publicRoutes.post('/newsletter', async (c: AppContext) => {
  const email = str((await body<{ email: string }>(c)).email).toLowerCase();
  if (!isEmail(email)) return invalid(c, { email: 'Enter a valid email address.' });
  const t = c.get('t');
  if (!t.newsletter.includes(email)) t.newsletter.push(email);
  // Double opt-in is off in the seed schools (Laravel answers subscribed: false, confirmation_required: true when on).
  return ok(c, { subscribed: true, confirmation_required: false }, 201);
});

/** Double opt-in confirmation: the mock accepts the token `valid` (Laravel verifies a signed, expiring token). */
publicRoutes.post('/forms/confirm', async (c: AppContext) => {
  const token = str((await body<{ token: string }>(c)).token);
  if (token !== 'valid') return invalid(c, { token: 'This confirmation link is invalid or has expired. Sign up again to get a new one.' });
  return ok(c, { confirmed: true });
});

const TOPICS = ['access', 'billing', 'refund', 'certificate', 'other'];

publicRoutes.post('/support/tickets', async (c: AppContext) => {
  const b = await body<SupportTicketInput>(c);
  const user = c.get('user');
  const email = user?.email ?? str(b.email).toLowerCase();
  const message = str(b.message);
  const errors: Record<string, string> = {};
  if (!TOPICS.includes(str(b.topic))) errors.topic = 'Choose a topic.';
  if (message.length < 10) errors.message = 'Add a few more details so we can help — at least 10 characters.';
  if (!isEmail(email)) errors.email = 'Enter a valid email address.';
  if (Object.keys(errors).length) return invalid(c, errors);
  const ticket = { id: id('tkt'), userId: user?.id ?? null, email, topic: str(b.topic), message, createdAt: new Date().toISOString() };
  c.get('t').tickets.push(ticket);
  return ok(c, { id: ticket.id }, 201);
});
