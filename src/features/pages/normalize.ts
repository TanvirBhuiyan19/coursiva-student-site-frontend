import type { Page, Section, SectionFrame } from './types';

/**
 * `GET /pages/{slug}` as the storefront renders it, whatever version of the API (or of a cached response) produced
 * it. A page cached before the common section frame and the 16t payload fields existed must render, not 500: every
 * section gets the frame defaults (no anchor, white / medium / left / contained, shown on every device, no
 * animation) and the kind fields added since (hero side and video, grid toggles, plan cards…) get safe defaults.
 * Unknown kinds pass through (the renderer skips them); malformed sections are dropped.
 */
type Raw = Record<string, unknown>;

const rec = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const arr = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);

const ANIMATIONS = ['fade_up', 'slide_in', 'zoom'] as const;

function frame(s: Raw): SectionFrame {
  const st = rec(s.style);
  const vis = rec(s.visibility);
  return {
    id: str(s.id),
    anchor: typeof s.anchor === 'string' && s.anchor !== '' ? s.anchor : null,
    style: {
      bg: oneOf(st.bg, ['white', 'gray', 'tint', 'brand', 'dark'], 'white'),
      pad: oneOf(st.pad, ['s', 'm', 'l'], 'm'),
      align: oneOf(st.align, ['left', 'center'], 'left'),
      width: oneOf(st.width, ['contained', 'full'], 'contained'),
      divider: bool(st.divider, false),
      variant: oneOf(st.variant, ['course', 'progress', 'cert'], 'course'),
    },
    visibility: { desktop: bool(vis.desktop, true), mobile: bool(vis.mobile, true) },
    animation: ANIMATIONS.includes(s.animation as (typeof ANIMATIONS)[number]) ? (s.animation as (typeof ANIMATIONS)[number]) : null,
  };
}

/** Kind fields added after the first release, with the value an older payload implied. */
function kindDefaults(s: Raw): Raw {
  switch (s.kind) {
    case 'hero':
      return {
        eyebrow: '',
        title: '',
        subtitle: '',
        primaryCta: { label: '', href: '/courses' },
        secondaryCta: null,
        stats: [],
        spotlight: null,
        compact: false,
        side: s.spotlight ? 'card' : 'none',
        video: null,
      };
    case 'featured_courses':
      return { title: '', courses: [], link: null, showPrice: true, showRating: true, variant: 'course' };
    case 'topics':
      return { title: '', categories: [] };
    case 'instructor':
      return {
        eyebrow: '',
        title: '',
        instructor: { name: '', initials: '', avatarUrl: null, color: 'var(--brand)', role: '', bio: '' },
        stats: [],
        video: null,
      };
    case 'membership_plans':
      return { subtitle: '', plans: [], annualToggle: false, staticPlans: [] };
    case 'testimonials':
    case 'value_props':
    case 'stats':
    case 'faq':
    case 'logos':
    case 'compare':
      return { title: '', items: [], columns: ['', '', ''], rows: [], highlight: 1 };
    case 'newsletter':
      return { title: '', body: '', placeholder: '', buttonLabel: '' };
    case 'text':
    case 'cta':
      return { title: '', body: '', button: null };
    case 'banner':
      return { title: '', button: null };
    case 'form':
      return { title: '', subtitle: '', fields: [], submitLabel: '', note: '', captcha: false, save: true, action: '' };
    case 'lead_form':
      return { formId: '', title: '', subtitle: '' };
    case 'quote':
      return { text: '', name: '', meta: '' };
    default:
      return {};
  }
}

function section(raw: unknown): Section | null {
  const s = rec(raw);
  if (typeof s.id !== 'string' || typeof s.kind !== 'string') return null;
  const out: Raw = { ...kindDefaults(s), ...s, ...frame(s) };
  // Null where an array is expected (an older or partial payload): use the default.
  for (const [k, v] of Object.entries(kindDefaults(s))) if (Array.isArray(v) && !Array.isArray(out[k])) out[k] = v;
  if (s.kind === 'testimonials')
    out.items = arr<Raw>(out.items).map((i) => ({ context: '', ...i, rating: typeof i.rating === 'number' ? i.rating : null }));
  if (s.kind === 'value_props') out.items = arr<Raw>(out.items).map((i) => ({ glyph: '', body: '', ...i }));
  if (s.kind === 'logos') out.items = arr<Raw>(out.items).map((i) => ({ imageUrl: null, ...i }));
  if (s.kind === 'form') out.fields = arr<Raw>(out.fields).map((f) => ({ required: false, options: [], ...f }));
  return out as unknown as Section;
}

export function normalizePage(raw: unknown): Page {
  const p = rec(raw);
  const seo = rec(p.seo);
  return {
    slug: str(p.slug),
    title: str(p.title),
    seo: {
      title: typeof seo.title === 'string' ? seo.title : null,
      description: typeof seo.description === 'string' ? seo.description : null,
      ogImageUrl: typeof seo.ogImageUrl === 'string' && seo.ogImageUrl !== '' ? seo.ogImageUrl : null,
      noindex: bool(seo.noindex, false),
    },
    sections: arr(p.sections)
      .map(section)
      .filter((s): s is Section => s !== null),
    updatedAt: str(p.updatedAt),
  };
}
