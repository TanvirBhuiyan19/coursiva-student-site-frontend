/**
 * The site builder's document and how Laravel turns it into the storefront's payloads — a faithful port of
 * backend/app/Modules/Site (SiteDocument::starter, SitePages, SiteChrome, SiteLinks, SiteVideo, SiteAccess), so the
 * mock returns exactly Laravel's shapes. Contract: docs/api/pages.md and docs/api/tenant.md.
 */
import { createHash, createHmac } from 'node:crypto';
import type { Category, CourseSummary } from '@/features/catalog/types';
import type { FormField, Page, Section, Stat, Video } from '@/features/pages/types';
import type { Site, SiteBuilderFields } from '@/features/tenant/types';
import type { Person } from '@/lib/api/types';
import { initials } from './db';
import { liveForm } from './forms';
import { courseSummary, membershipPlans } from './present';
import type { TenantData } from './records';

/* ── The builder document (tenant-dashboard src/features/sitebuilder/types.ts) ── */

export interface BItem {
  a: string;
  b: string;
  c: string;
  on: boolean;
}

export interface BSection {
  id: string;
  kind: string;
  name: string;
  hide: boolean;
  txt: Record<string, string>;
  items: BItem[];
  st: {
    bg: 'white' | 'gray' | 'tint' | 'brand' | 'dark';
    pad: 'S' | 'M' | 'L';
    al: 'left' | 'center';
    w: 'contained' | 'full';
    div: boolean;
    v: 'course' | 'progress' | 'cert';
    side: 'none' | 'card' | 'video';
  };
  opt: Record<string, boolean | string>;
  set: { desk: boolean; mob: boolean; anchor: string; anim: 'None' | 'Fade up' | 'Slide in' | 'Zoom'; ab: boolean };
}

export interface BPage {
  id: string;
  title: string;
  slug: string;
  group: string;
  template: boolean;
  visibility: 'Public' | 'Members only' | 'Password';
  password: string;
  showInNav: boolean;
  seoTitle: string;
  seoDescription: string;
  sections: BSection[];
}

export interface BDoc {
  header: BSection;
  footer: BSection;
  theme: {
    font: 'Bricolage + Instrument' | 'Editorial serif' | 'Minimal sans';
    radius: 'Sharp' | 'Soft' | 'Round';
    buttons: 'Filled' | 'Outline' | 'Soft';
    density: 'Compact' | 'Comfortable';
    announcementOn: boolean;
    announcementText: string;
  };
  settings: {
    cookieBanner: boolean;
    indexing: boolean;
    siteLock: boolean;
    sitePassword: string;
    headCode: string;
    featuresOff: string[];
    social: { network: string; url: string }[];
    favicon: { assetId: string; url: string } | null;
    shareImage: { assetId: string; url: string } | null;
  };
  pages: BPage[];
}

/** Builder state per tenant: what is live on the website (null = never published → the starter site), the draft. */
export interface BuilderState {
  live: BDoc | null;
  draft: BDoc;
  /** Valid `?preview=` tokens (dashboard preview links). */
  previewTokens: string[];
  publishedAt: string | null;
  draftUpdatedAt: string;
  submissions: {
    id: string;
    pageId: string;
    sectionId: string;
    values: { id: string; label: string; type: string; value: string | boolean }[];
    createdAt: string;
  }[];
  contacts: { email: string; name: string | null; source: string; tag: string }[];
}

const DEFAULT_STYLE: BSection['st'] = { bg: 'white', pad: 'M', al: 'left', w: 'contained', div: false, v: 'course', side: 'none' };

type ItemSpec = string | [string, string?, string?] | BItem;

/** A section, as the dashboard stores it. */
export function sec(
  id: string,
  kind: string,
  txt: Record<string, string> = {},
  items: ItemSpec[] = [],
  st: Partial<BSection['st']> = {},
  opt: BSection['opt'] = {},
  set: Partial<BSection['set']> = {},
): BSection {
  return {
    id,
    kind,
    name: '',
    hide: false,
    txt,
    items: items.map((i) =>
      typeof i === 'string' ? { a: i, b: '', c: '', on: true } : Array.isArray(i) ? { a: i[0], b: i[1] ?? '', c: i[2] ?? '', on: true } : i,
    ),
    st: { ...DEFAULT_STYLE, ...st },
    opt,
    set: { desk: true, mob: true, anchor: '', anim: 'None', ab: false, ...set },
  };
}

export function page(id: string, title: string, slug: string, sections: BSection[], extra: Partial<BPage> = {}): BPage {
  return {
    id,
    title,
    slug,
    group: 'Marketing',
    template: false,
    visibility: 'Public',
    password: '',
    showInNav: false,
    seoTitle: '',
    seoDescription: '',
    sections,
    ...extra,
  };
}

/** SiteDocument::starter — what a school's site is before its first publish. */
export function starter(name: string): BDoc {
  let n = 0;
  const s = (
    kind: string,
    txt: Record<string, string>,
    items: ItemSpec[] = [],
    st: Partial<BSection['st']> = {},
    opt: BSection['opt'] = {},
  ) => sec(`s${++n}`, kind, txt, items, st, opt);
  const year = new Date().getFullYear();
  return {
    header: {
      ...s(
        'header',
        { logo: name, cta: 'Browse courses' },
        ['Home', 'Courses', 'My learning'],
        {},
        { sticky: true, cart: true, notif: true },
      ),
      id: 'header',
    },
    footer: {
      ...s(
        'footer',
        { tagline: '', copy: `© ${year} ${name}. All rights reserved.` },
        [
          ['All courses', 'Learn'],
          ['My learning', 'Learn'],
          ['Help centre', 'Support'],
        ],
        {},
        { social: true, legal: true, powered: true },
      ),
      id: 'footer',
    },
    theme: {
      font: 'Bricolage + Instrument',
      radius: 'Soft',
      buttons: 'Filled',
      density: 'Comfortable',
      announcementOn: false,
      announcementText: '',
    },
    settings: {
      cookieBanner: true,
      indexing: true,
      siteLock: false,
      sitePassword: '',
      headCode: '',
      featuresOff: [],
      social: [],
      favicon: null,
      shareImage: null,
    },
    pages: [
      page(
        'home',
        'Home',
        '/',
        [
          s(
            'hero',
            {
              badge: 'Now enrolling',
              title: `Learn with ${name}`,
              sub: 'Practical, self-paced courses — start today and learn at your own pace.',
              btn: 'Browse courses',
              btn2: 'My learning',
            },
            [],
            { bg: 'tint', pad: 'L', side: 'card' },
          ),
          s('grid', { title: 'Featured courses', link: 'See all →' }, [], {}, { src: 'Featured courses', price: true, rating: true }),
          s('topics', { title: 'Browse by topic' }),
          s('features', { title: '' }, [
            ['Learn at your pace', 'Lifetime access to every lesson.', '∞'],
            ['Certificates', 'Earn a certificate when you finish.', '✓'],
            ['Always improving', 'New lessons and updates, included.', '✦'],
          ]),
        ],
        { showInNav: true },
      ),
      page(
        'login',
        'Sign in',
        '/login',
        [
          s(
            'auth',
            {
              title: 'Welcome back',
              sub: 'Sign in to continue learning.',
              btn: 'Sign in',
              tagline: `Learn with ${name}`,
              quote: '',
              quote_by: '',
            },
            [],
            { pad: 'L' },
            { signup: true, forgot: true },
          ),
        ],
        { group: 'Account & legal' },
      ),
    ],
  };
}

/* ── Server-made labels (backend lang/en/storefront.php) ── */

export const LABELS = {
  browseCourses: 'Browse courses',
  featuredCourses: 'Featured courses',
  whatStudentsSay: 'What students say',
  browseByTopic: 'Browse by topic',
  membership: 'Membership',
  student: 'Student',
  links: 'Links',
  joinPlan: (plan: string) => `Join ${plan}`,
  learnWith: (name: string) => `Learn with ${name}`,
  courses: (n: number) => (n === 1 ? 'course' : 'courses'),
  avgRating: 'avg rating',
  completionRate: 'completion rate',
  studentsTaught: 'students taught',
  avgCourseRating: 'avg course rating',
  certificatesIssued: 'certificates issued',
  errors: {
    pageNotFound: 'Page not found.',
    siteLocked: 'This site is private. Enter the password to continue.',
    pagePassword: 'This page is password protected.',
    membersSignIn: 'This page is for members. Sign in to continue.',
    membersOnly: 'This page is only for members.',
    wrongPassword: 'That password isn’t right.',
    noSitePassword: 'This site can’t be unlocked with a password.',
    formNotFound: 'This form isn’t available any more.',
  },
  form: {
    required: 'This field is required.',
    email: 'Enter a valid email address.',
    phone: 'Enter a valid phone number.',
    choice: 'Choose one of the options.',
    max: (max: number) => `Keep this to ${max.toLocaleString('en-US')} characters or fewer.`,
    checkbox: 'Tick this box to continue.',
  },
} as const;

/* ── Links (SiteLinks) ── */

export const ROUTES: Record<string, string> = {
  catalog: '/courses',
  learning: '/learning',
  checkout: '/checkout',
  cart: '/cart',
  login: '/sign-in',
  signup: '/sign-up',
  membership: '/membership',
  community: '/community',
  certificates: '/certificates',
  help: '/help',
  contact: '/contact',
  wishlist: '/wishlist',
};
const PATH_ALIASES: Record<string, string> = { '/login': '/sign-in', '/signup': '/sign-up', '/profile': '/account' };
const LEGACY: Record<string, string> = {
  'course catalog': 'catalog',
  catalog: 'catalog',
  courses: 'catalog',
  'all courses': 'catalog',
  'browse courses': 'catalog',
  'my learning': 'learning',
  learning: 'learning',
  'start the course': 'learning',
  checkout: 'checkout',
  cart: 'cart',
  'log in': 'login',
  login: 'login',
  'sign in': 'login',
  'sign up': 'signup',
  signup: 'signup',
  membership: 'membership',
  community: 'community',
  certificates: 'certificates',
  help: 'help',
  'help centre': 'help',
  'help center': 'help',
  contact: 'contact',
  wishlist: 'wishlist',
};

export function linkResolver(pages: BPage[], courseSlug: (id: string) => string | null) {
  const paths = new Map<string, string>();
  const titles = new Map<string, string>();
  for (const p of pages) {
    if (p.template) continue;
    const path = PATH_ALIASES[p.slug] ?? p.slug;
    paths.set(p.id, path);
    const key = p.title.trim().toLowerCase();
    if (!titles.has(key)) titles.set(key, path);
  }
  const legacy = (label: string): string | null => {
    if (label === 'home') return '/';
    const byTitle = titles.get(label);
    if (byTitle) return byTitle;
    const route = LEGACY[label];
    return route ? (ROUTES[route] ?? null) : null;
  };
  const resolve = (raw: string): string | null => {
    const v = raw.trim();
    if (v === '') return null;
    if (v.startsWith('page:')) return paths.get(v.slice(5)) ?? null;
    if (v.startsWith('route:')) return ROUTES[v.slice(6)] ?? null;
    if (v.startsWith('course:')) {
      const slug = courseSlug(v.slice(7));
      return slug === null ? null : `/courses/${slug}`;
    }
    if (v.startsWith('#')) return /^#[a-z0-9-]{1,60}$/.test(v) ? v : null;
    if (/^(\/(?!\/)[^\s\\]*|https:\/\/[^\s/]+\S*)$/.test(v)) return v;
    return legacy(v.toLowerCase());
  };
  // Header / footer `#anchor` links (Laravel SiteLinks::chrome): the page with a shown section that has the anchor,
  // home first — `/#faq`, `/offer#pricing`; null (the item is left out) when no page has it.
  const anchors = new Map<string, string>();
  for (const p of pages) {
    if (p.template) continue;
    const path = PATH_ALIASES[p.slug] ?? p.slug;
    for (const s of p.sections) {
      const shown = !s.hide && (s.set.desk || s.set.mob) && !APP_SCREEN_KINDS.includes(s.kind);
      if (s.set.anchor && shown && (!anchors.has(s.set.anchor) || path === '/')) anchors.set(s.set.anchor, path);
    }
  }
  const chrome = (raw: string): string | null => {
    const v = raw.trim();
    if (!v.startsWith('#')) return resolve(v);
    const path = /^#[a-z0-9-]{1,60}$/.test(v) ? anchors.get(v.slice(1)) : undefined;
    return path === undefined ? null : `${path}${v}`;
  };
  return { resolve, chrome, href: (raw: string, fallback: string) => resolve(raw) ?? fallback };
}

/* ── Videos (SiteVideo) ── */

export function parseVideo(raw: string, mediaUrl: (id: string) => string | null): Video | null {
  const v = raw.trim();
  const media = /^media:([A-Za-z0-9_]{1,40})$/.exec(v);
  if (media) {
    const url = mediaUrl(media[1]!);
    return url === null ? null : { url, provider: 'media', embedUrl: null };
  }
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (!['https:', 'http:'].includes(u.protocol) || u.username) return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
  const path = u.pathname;
  if (['youtube.com', 'youtube-nocookie.com', 'youtu.be'].includes(host)) {
    const id =
      host === 'youtu.be'
        ? path.replace(/^\//, '')
        : path === '/watch'
          ? (u.searchParams.get('v') ?? '')
          : (/^\/(embed|shorts|live)\/([^/]+)$/.exec(path)?.[2] ?? '');
    return /^[A-Za-z0-9_-]{11}$/.test(id)
      ? { url: `https://www.youtube.com/watch?v=${id}`, provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}` }
      : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = (host === 'vimeo.com' ? /^\/(\d{1,12})(?:\/([a-f0-9]{6,20}))?\/?$/ : /^\/video\/(\d{1,12})\/?$/).exec(path);
    if (!m) return null;
    const h = u.searchParams.get('h');
    const hash = m[2] ?? (h && /^[a-f0-9]{6,20}$/.test(h) ? h : '');
    return {
      url: `https://vimeo.com/${m[1]}`,
      provider: 'vimeo',
      embedUrl: `https://player.vimeo.com/video/${m[1]}${hash ? `?h=${hash}` : ''}`,
    };
  }
  if (host === 'loom.com') {
    const m = /^\/(share|embed)\/([a-f0-9]{32})\/?$/.exec(path);
    return m ? { url: `https://www.loom.com/share/${m[2]}`, provider: 'loom', embedUrl: `https://www.loom.com/embed/${m[2]}` } : null;
  }
  if (/(^|\.)wistia\.(com|net)$/.test(host)) {
    const m = /^\/(?:medias|embed\/iframe|embed\/medias)\/([a-z0-9]{10})(?:\.jsonp)?\/?$/.exec(path);
    return m
      ? { url: `https://fast.wistia.net/medias/${m[1]}`, provider: 'wistia', embedUrl: `https://fast.wistia.net/embed/iframe/${m[1]}` }
      : null;
  }
  return null;
}

/* ── Access (SiteAccess) ── */

export const SITE_COOKIE = 'coursiva_site_unlock';
const KEY = 'mock-app-key';
export const unlockToken = (kind: 'site' | 'page', tenant: string, pageId: string, password: string) =>
  createHmac('sha256', KEY).update([kind, tenant, pageId, password].join('|')).digest('hex');
export const pageCookie = (pageId: string) => `coursiva_page_unlock_${createHash('sha256').update(pageId).digest('hex').slice(0, 16)}`;

/** What is live on the website: the newest web publish, else the starter site. */
export const liveDoc = (t: TenantData): BDoc => t.builder.live ?? starter(t.site.name);

/** The non-template page a public slug names (`home` → `/`, `about/team` → `/about/team`). */
export function pageFor(doc: BDoc, slug: string): BPage | null {
  const path = slug === 'home' ? '/' : `/${slug}`;
  return doc.pages.find((p) => p.slug === path && !p.template) ?? null;
}

export const SLUG = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;

/** Members: a live enrolment, or a membership that grants access. */
export function isMember(t: TenantData, userId: string): boolean {
  return t.enrollments.some((e) => e.userId === userId) || t.users.some((u) => u.id === userId && u.membershipPlanId !== null);
}

/* ── Pages (SitePages) ── */

const APP_SCREEN_KINDS = [
  'coursedetail',
  'cart',
  'dashboard',
  'community',
  'profile',
  'auth',
  'legal',
  'help',
  'contact',
  'checkout',
  'filters',
  'list',
  'player',
];
const PERSONAL_SOURCES = ['My enrolled courses', 'My certificates'];
const ANIMATIONS: Record<string, 'fade_up' | 'slide_in' | 'zoom'> = { 'Fade up': 'fade_up', 'Slide in': 'slide_in', Zoom: 'zoom' };
const BUTTON_ROWS = /paypal|apple pay|continue with/i;
const VARIABLES = ['{first_name}', '{course_title}', '{price}', '{progress}'];

const visible = (s: BSection) => s.items.filter((i) => i.on);

const hueColor = (seed: string) => {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `oklch(0.52 0.13 ${h % 360})`;
};

export function builderContext(t: TenantData, doc: BDoc) {
  const name = t.site.name;
  const text = (v: string) => {
    let out = v.replaceAll('{tenant}', name);
    for (const variable of VARIABLES) out = out.replaceAll(variable, '');
    return out.trim();
  };
  const summaries: CourseSummary[] = [...t.courses].sort((a, b) => b.studentCount - a.studentCount).map((c) => courseSummary(t, c));
  const links = linkResolver(doc.pages, (id) => summaries.find((c) => c.id === id.trim())?.slug ?? null);
  const person = (raw: string): Person => {
    const n = raw !== '' ? raw : LABELS.student;
    return { name: n, initials: initials(n), avatarUrl: null, color: hueColor(n) };
  };
  const mediaUrl = (id: string) =>
    t.mediaVideos.includes(id)
      ? `${t.site.primaryHost.endsWith('.localhost') ? 'http' : 'https'}://${t.site.primaryHost}/api/v1/site/assets/${id}`
      : null;
  return { name, text, summaries, links, person, mediaUrl };
}

type Ctx = ReturnType<typeof builderContext>;

/** A form section's fields; ids follow the order of the visible rows. */
export function formFields(ctx: Ctx, s: BSection): FormField[] {
  const fields: FormField[] = [];
  for (const item of visible(s)) {
    let label = ctx.text(item.a);
    if (label === '' || BUTTON_ROWS.test(label)) continue;
    const required = label.endsWith('*');
    label = label.replace(/\*+$/, '').trim();
    const hay = (item.b.trim() !== '' ? item.b : label).toLowerCase();
    const type: FormField['type'] = hay.includes('email')
      ? 'email'
      : /phone|\btel\b|mobile/.test(hay)
        ? 'phone'
        : /long|message|textarea|paragraph/.test(hay)
          ? 'long_text'
          : /choice|select|dropdown/.test(hay)
            ? 'choice'
            : /check|agree|consent/.test(hay)
              ? 'checkbox'
              : 'text';
    const options =
      type === 'choice'
        ? item.c
            .split('|')
            .map((o) => o.trim())
            .filter(Boolean)
        : [];
    fields.push({ id: `f${fields.length + 1}`, label, type, required, options });
  }
  return fields;
}

function heroStats(t: TenantData, ctx: Ctx): Stat[] {
  const rated = ctx.summaries.filter((c) => c.reviewCount > 0);
  const ids = new Set(ctx.summaries.map((c) => c.id));
  const enrolments = t.enrollments.filter((e) => ids.has(e.courseId));
  const completed = enrolments.filter((e) => {
    const course = t.courses.find((c) => c.id === e.courseId)!;
    const lessons = course.modules.flatMap((m) => m.lessons.map((l) => l.id));
    return lessons.length > 0 && lessons.every((l) => t.completions.some((x) => x.userId === e.userId && x.lessonId === l));
  });
  return [
    { value: String(ctx.summaries.length), label: LABELS.courses(ctx.summaries.length) },
    ...(rated.length ? [{ value: (rated.reduce((a, c) => a + c.rating, 0) / rated.length).toFixed(1), label: LABELS.avgRating }] : []),
    ...(enrolments.length ? [{ value: `${Math.round((completed.length / enrolments.length) * 100)}%`, label: LABELS.completionRate }] : []),
  ];
}

function instructorStats(t: TenantData, ctx: Ctx): Stat[] {
  const rated = ctx.summaries.filter((c) => c.reviewCount > 0);
  const students = new Set(t.enrollments.map((e) => e.userId)).size;
  const certificates = t.certificates.length;
  return [
    { value: students.toLocaleString('en-US'), label: LABELS.studentsTaught },
    ...(rated.length
      ? [{ value: `${(rated.reduce((a, c) => a + c.rating, 0) / rated.length).toFixed(1)}★`, label: LABELS.avgCourseRating }]
      : []),
    ...(certificates ? [{ value: certificates.toLocaleString('en-US'), label: LABELS.certificatesIssued }] : []),
  ];
}

const itemStats = (ctx: Ctx, items: BItem[]): Stat[] => items.map((i) => ({ value: ctx.text(i.a), label: ctx.text(i.b) }));

function categories(t: TenantData): Category[] {
  return t.categories
    .map((cat) => ({ ...cat, courseCount: t.courses.filter((x) => x.categorySlug === cat.slug).length }))
    .filter((c) => c.courseCount > 0);
}

/** One builder section → its storefront payload (without the frame), or null when it has nothing to show. */
function section(t: TenantData, ctx: Ctx, s: BSection, slug: string): Record<string, unknown> | null {
  const txt = (k: string) => ctx.text(s.txt[k] ?? '');
  const raw = (k: string) => (s.txt[k] ?? '').trim();
  const items = visible(s);
  const button = (fallback: string) => (txt('btn') === '' ? null : { label: txt('btn'), href: ctx.links.href(raw('btn_to'), fallback) });
  const video = (key: string) => (raw(key) === '' ? null : parseVideo(raw(key), ctx.mediaUrl));

  switch (s.kind) {
    case 'hero': {
      let side = s.st.side;
      const v = side === 'video' ? video('video_url') : null;
      const spotlight = side === 'card' ? (ctx.summaries[0] ?? null) : null;
      if ((side === 'video' && !v) || (side === 'card' && !spotlight)) side = 'none';
      return {
        kind: 'hero',
        eyebrow: txt('badge'),
        title: txt('title'),
        subtitle: txt('sub'),
        primaryCta: { label: txt('btn') !== '' ? txt('btn') : LABELS.browseCourses, href: ctx.links.href(raw('btn_to'), ROUTES.catalog!) },
        secondaryCta: txt('btn2') === '' ? null : { label: txt('btn2'), href: ctx.links.href(raw('btn2_to'), ROUTES.learning!) },
        stats: items.length ? itemStats(ctx, items) : heroStats(t, ctx),
        spotlight,
        compact: s.opt.compact === true,
        side,
        video: v,
      };
    }
    case 'grid': {
      const source = typeof s.opt.src === 'string' && s.opt.src !== '' ? s.opt.src : 'Featured courses';
      if (PERSONAL_SOURCES.includes(source)) return null;
      const all = ctx.summaries;
      let courses: CourseSummary[];
      if (source === 'Manual') {
        const picked = items
          .map(
            (i) =>
              all.find((c) => [i.c.trim(), i.a.trim()].includes(c.id)) ??
              all.find((c) => c.title.toLowerCase() === i.a.trim().toLowerCase()),
          )
          .filter((c): c is CourseSummary => !!c);
        courses = picked.filter((c, i) => picked.findIndex((x) => x.id === c.id) === i);
      } else if (source.startsWith('Category: ')) {
        courses = all.filter((c) => c.category?.name.toLowerCase() === source.slice(10).toLowerCase()).slice(0, 12);
      } else if (source === 'All published courses') courses = all.slice(0, 12);
      else courses = all.slice(0, 3);
      return courses.length === 0
        ? null
        : {
            kind: 'featured_courses',
            title: txt('title') !== '' ? txt('title') : LABELS.featuredCourses,
            courses,
            link: txt('link') === '' ? null : { label: txt('link'), href: ctx.links.href(raw('link_to'), ROUTES.catalog!) },
            showPrice: s.opt.price !== false,
            showRating: s.opt.rating !== false,
            variant: s.st.v,
          };
    }
    case 'topics': {
      const cats = categories(t);
      return cats.length === 0
        ? null
        : { kind: 'topics', title: txt('title') !== '' ? txt('title') : LABELS.browseByTopic, categories: cats };
    }
    case 'bio': {
      const v = video('video_url');
      let videoPayload: Record<string, unknown> | null = null;
      if (v) {
        const parts = txt('caption')
          .split('·')
          .map((p) => p.trim());
        let seconds = 0;
        const last = parts.at(-1) ?? '';
        const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(last);
        if (parts.length > 1 && m) {
          seconds = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
          parts.pop();
        }
        videoPayload = { title: parts.join(' · '), durationSeconds: seconds, posterUrl: null, ...v };
      }
      return {
        kind: 'instructor',
        eyebrow: txt('eyebrow'),
        title: txt('title'),
        instructor: { ...ctx.person(txt('name') !== '' ? txt('name') : ctx.name), role: txt('role'), bio: txt('text') },
        stats: items.length ? itemStats(ctx, items) : instructorStats(t, ctx),
        video: videoPayload,
      };
    }
    case 'pricing': {
      const plans = t.site.features.membership ? membershipPlans(t) : [];
      const href = ctx.links.href(raw('btn_to'), ROUTES.signup!);
      const staticPlans = plans.length
        ? []
        : items.map((i, j) => ({
            name: ctx.text(i.a),
            price: ctx.text(i.b),
            description: ctx.text(i.c),
            highlighted: j === 1,
            button: { label: LABELS.joinPlan(ctx.text(i.a)), href },
          }));
      return plans.length === 0 && staticPlans.length === 0
        ? null
        : {
            kind: 'membership_plans',
            title: txt('title') !== '' ? txt('title') : LABELS.membership,
            subtitle: txt('sub'),
            annualToggle: s.opt.annual === true,
            plans,
            staticPlans,
          };
    }
    case 'testimonial': {
      let quotes = items.map((i) => ({
        quote: ctx.text(i.a),
        rating: null as number | null,
        author: ctx.person(ctx.text(i.b)),
        context: ctx.text(i.c),
      }));
      if (quotes.length === 0) {
        // Learner feedback featured from Student experience (0–10 score → stars out of 5).
        quotes = t.home.testimonials.slice(0, 6).map((f) => ({
          quote: f.quote,
          rating: f.rating,
          author: ctx.person(f.name),
          context: t.courses.find((c) => c.slug === f.courseSlug)?.title ?? '',
        }));
      }
      return quotes.length === 0
        ? null
        : { kind: 'testimonials', title: txt('title') !== '' ? txt('title') : LABELS.whatStudentsSay, items: quotes };
    }
    case 'features':
      return items.length === 0
        ? null
        : {
            kind: 'value_props',
            title: txt('title'),
            items: items.map((i) => ({
              icon: i.c.trim() === '∞' ? 'infinity' : i.c.trim() === '✦' ? 'sparkle' : 'check',
              glyph: i.c.trim(),
              title: ctx.text(i.a),
              body: ctx.text(i.b),
            })),
          };
    case 'cta':
      if (txt('ph') !== '')
        return { kind: 'newsletter', title: txt('title'), body: txt('sub'), placeholder: txt('ph'), buttonLabel: txt('btn') };
      if (txt('title') === '' && txt('btn') === '') return null;
      return { kind: 'cta', title: txt('title'), body: txt('sub'), button: button(ROUTES.catalog!) };
    case 'text':
      return txt('title') === '' && txt('body') === '' ? null : { kind: 'text', title: txt('title'), body: txt('body') };
    case 'stats':
      return items.length === 0 ? null : { kind: 'stats', items: itemStats(ctx, items) };
    case 'faq':
      return items.length === 0
        ? null
        : { kind: 'faq', title: txt('title'), items: items.map((i) => ({ question: ctx.text(i.a), answer: ctx.text(i.b) })) };
    case 'logos':
      return items.length === 0
        ? null
        : {
            kind: 'logos',
            title: txt('title'),
            items: items.map((i) => ({ name: ctx.text(i.a), imageUrl: /^https:\/\/[^\s/]+\S*$/.test(i.b.trim()) ? i.b.trim() : null })),
          };
    case 'video': {
      const v = video('url');
      return v ? { kind: 'video', caption: txt('caption'), video: v } : null;
    }
    case 'banner':
      return txt('title') === '' ? null : { kind: 'banner', title: txt('title'), button: button('/checkout') };
    case 'form': {
      // Set to one of the school's live lead forms (`opt.lead_form`): the lead form instead of the builder form.
      const leadForm = typeof s.opt.lead_form === 'string' && s.opt.lead_form !== '' ? liveForm(t, s.opt.lead_form) : null;
      if (leadForm) return { kind: 'lead_form', formId: leadForm.id, title: txt('title'), subtitle: txt('sub') };
      const fields = formFields(ctx, s);
      return fields.length === 0
        ? null
        : {
            kind: 'form',
            title: txt('title'),
            subtitle: txt('sub'),
            fields,
            submitLabel: txt('btn'),
            note: txt('note'),
            captcha: s.opt.captcha === true,
            save: s.opt.save !== false,
            action: `/api/v1/pages/${slug}/forms/${s.id}`,
          };
    }
    case 'compare':
      return items.length === 0
        ? null
        : {
            kind: 'compare',
            title: txt('title'),
            columns: [txt('c1'), txt('c2'), txt('c3')],
            highlight: 1,
            rows: items.map((i) => {
              const cells = i.b.split('|').map((v) => ctx.text(v));
              return { feature: ctx.text(i.a), values: [cells[0] ?? '', cells[1] ?? '', cells[2] ?? ''] };
            }),
          };
    case 'quote':
      return txt('text') === ''
        ? null
        : { kind: 'quote', text: txt('text'), name: txt('name'), meta: txt('meta'), author: ctx.person(txt('name')) };
    default:
      return null;
  }
}

/** SitePages::resolve — the storefront `Page`. */
export function resolvePage(t: TenantData, doc: BDoc, p: BPage, slug: string, updatedAt: string): Page {
  const ctx = builderContext(t, doc);
  const sections: Section[] = [];
  for (const s of p.sections) {
    const desktop = s.set.desk;
    const mobile = s.set.mob;
    if (s.hide || (!desktop && !mobile) || APP_SCREEN_KINDS.includes(s.kind)) continue;
    const payload = section(t, ctx, s, slug);
    if (!payload) continue;
    sections.push({
      id: s.id,
      kind: payload.kind,
      anchor: s.set.anchor !== '' ? s.set.anchor : null,
      style: { bg: s.st.bg, pad: s.st.pad.toLowerCase(), align: s.st.al, width: s.st.w, divider: s.st.div, variant: s.st.v },
      visibility: { desktop, mobile },
      animation: ANIMATIONS[s.set.anim] ?? null,
      ...payload,
    } as unknown as Section);
  }
  const nullable = (v: string) => (v.trim() !== '' ? ctx.text(v) : null);
  return {
    slug,
    title: p.title,
    seo: {
      title: nullable(p.seoTitle),
      description: nullable(p.seoDescription),
      ogImageUrl: doc.settings.shareImage?.url ?? null,
      noindex: p.visibility !== 'Public',
    },
    sections,
    updatedAt,
  };
}

/* ── Site chrome (SiteChrome) ── */

const THEME = {
  font: { 'Bricolage + Instrument': 'bricolage_instrument', 'Editorial serif': 'editorial_serif', 'Minimal sans': 'minimal_sans' },
  radius: { Sharp: 'sharp', Soft: 'soft', Round: 'round' },
  buttons: { Filled: 'filled', Outline: 'outline', Soft: 'soft' },
  density: { Compact: 'compact', Comfortable: 'comfortable' },
} as const;

/** What `GET /site` adds from the site builder. */
export function chrome(t: TenantData, doc: BDoc, preview: boolean): Omit<Pick<Site, SiteBuilderFields>, 'siteLock' | 'pages'> {
  const ctx = builderContext(t, doc);
  const { text, links } = ctx;
  const off = doc.settings.featuresOff;

  const items: { label: string; href: string }[] = [];
  for (const item of visible(doc.header)) {
    const href = item.b.trim() !== '' ? links.chrome(item.b) : links.resolve(item.a);
    if (text(item.a) !== '' && href !== null) items.push({ label: text(item.a), href });
  }
  for (const p of doc.pages) {
    if (p.showInNav && !p.template) {
      const href = links.resolve(`page:${p.id}`);
      if (href !== null) items.push({ label: text(p.title), href });
    }
  }
  const cta = text(doc.header.txt.cta ?? '');

  const columns: { title: string; links: { label: string; href: string }[] }[] = [];
  for (const item of visible(doc.footer)) {
    const href = item.c.trim() !== '' ? links.chrome(item.c) : links.resolve(item.a);
    if (text(item.a) === '' || href === null) continue;
    const title = text(item.b) !== '' ? text(item.b) : LABELS.links;
    let col = columns.find((c) => c.title === title);
    if (!col) columns.push((col = { title, links: [] }));
    col.links.push({ label: text(item.a), href });
  }

  const sectionOf = (slugs: string[], kind: string) => {
    for (const slug of slugs)
      for (const p of doc.pages) if (p.slug === slug) for (const s of p.sections) if (s.kind === kind && !s.hide) return s;
    return null;
  };
  const legal = (slug: string) => {
    const s = sectionOf([slug], 'legal');
    return s === null
      ? null
      : {
          title: text(s.txt.title ?? ''),
          updated: text(s.txt.date ?? ''),
          back: text(s.txt.back ?? ''),
          sections: visible(s).map((i) => ({ heading: text(i.a), body: text(i.b) })),
          footer: text(s.txt.foot ?? ''),
        };
  };
  const auth = sectionOf(['/login', '/sign-in'], 'auth');
  const quote = auth === null ? '' : text(auth.txt.quote ?? '');

  return {
    navigation: {
      header: {
        logoText: text(doc.header.txt.logo ?? '') !== '' ? text(doc.header.txt.logo ?? '') : ctx.name,
        cta: cta === '' ? null : { label: cta, href: links.chrome(doc.header.txt.cta_to ?? '') ?? ROUTES.catalog! },
        sticky: doc.header.opt.sticky !== false,
        showCart: doc.header.opt.cart === true && !off.includes('cart'),
        showNotifications: doc.header.opt.notif === true,
        items: items.filter((x, i) => items.findIndex((y) => y.href === x.href) === i),
      },
      footer: {
        tagline: text(doc.footer.txt.tagline ?? ''),
        copyright: text(doc.footer.txt.copy ?? '').replace('{year}', String(new Date().getFullYear())),
        columns,
        showSocial: doc.footer.opt.social === true,
        showLegal: doc.footer.opt.legal !== false,
        showPowered: doc.footer.opt.powered === true || !t.site.whiteLabel,
      },
    },
    theme: {
      font: THEME.font[doc.theme.font] ?? 'bricolage_instrument',
      radius: THEME.radius[doc.theme.radius] ?? 'sharp',
      buttons: THEME.buttons[doc.theme.buttons] ?? 'filled',
      density: THEME.density[doc.theme.density] ?? 'compact',
    },
    announcement: doc.theme.announcementOn && text(doc.theme.announcementText) !== '' ? { text: text(doc.theme.announcementText) } : null,
    faviconUrl: doc.settings.favicon?.url ?? null,
    headCode: !preview && doc.settings.headCode.trim() !== '' ? doc.settings.headCode : null,
    cookieBanner: t.privacy.cookieBanner,
    screens: {
      auth:
        auth === null
          ? null
          : {
              title: text(auth.txt.title ?? ''),
              subtitle: text(auth.txt.sub ?? ''),
              button: text(auth.txt.btn ?? ''),
              tagline: text(auth.txt.tagline ?? ''),
              quote: quote === '' ? null : { text: quote, author: text(auth.txt.quote_by ?? '') },
              benefits: visible(auth)
                .map((i) => text(i.a))
                .filter((b) => b !== ''),
              signup: auth.opt.signup !== false,
              google: auth.opt.google !== false,
              forgot: auth.opt.forgot !== false,
            },
      legal: { privacy: legal('/privacy'), terms: legal('/terms'), refundPolicy: legal('/refund-policy') },
    },
  };
}
