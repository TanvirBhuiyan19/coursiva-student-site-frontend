/**
 * Site-builder pages. The school composes pages from sections in the dashboard's site builder; the API returns them
 * resolved (courses, plans, stats and links already looked up), so what the school sees in the editor canvas is what
 * learners get. Contract: docs/api/pages.md
 */
import type { CourseSummary, Category } from '@/features/catalog/types';
import type { MembershipPlan } from '@/features/membership/types';
import type { Person } from '@/lib/api/types';

/** A resolved link: a site path (`/courses`, `/about#faq`), an `#anchor` on the same page, or an `https://` URL. */
export interface Cta {
  label: string;
  href: string;
}

export interface Stat {
  value: string;
  label: string;
}

/** An allow-listed video. Third-party providers come with a server-built `embedUrl`; `media` plays `url` directly. */
export interface Video {
  url: string;
  provider: 'youtube' | 'vimeo' | 'loom' | 'wistia' | 'media';
  embedUrl: string | null;
}

export type SectionBg = 'white' | 'gray' | 'tint' | 'brand' | 'dark';
export type SectionAnimation = 'fade_up' | 'slide_in' | 'zoom';

/** The common frame every section carries (docs/api/pages.md → "Sections: the common frame"). */
export interface SectionFrame {
  /** The builder's stable id — the React key. */
  id: string;
  /** Becomes the section element's `id`, so `#anchor` links land on it. */
  anchor: string | null;
  style: {
    bg: SectionBg;
    pad: 's' | 'm' | 'l';
    align: 'left' | 'center';
    width: 'contained' | 'full';
    /** A divider line above the section. */
    divider: boolean;
    /** Card variant; only meaningful for `featured_courses`. */
    variant: 'course' | 'progress' | 'cert';
  };
  /** Hidden per breakpoint with CSS (mobile < 720px). Never both false — those are omitted by the API. */
  visibility: { desktop: boolean; mobile: boolean };
  /** Entrance animation; skipped under prefers-reduced-motion. */
  animation: SectionAnimation | null;
}

export interface HeroSection extends SectionFrame {
  kind: 'hero';
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryCta: Cta;
  secondaryCta: Cta | null;
  stats: Stat[];
  spotlight: CourseSummary | null;
  /** A compact page title instead of a full hero (smaller type, no side content). */
  compact: boolean;
  side: 'none' | 'card' | 'video';
  video: Video | null;
}

export interface FeaturedCoursesSection extends SectionFrame {
  kind: 'featured_courses';
  title: string;
  courses: CourseSummary[];
  /** The heading's "See all" link; `null` when the school left its label empty. */
  link: Cta | null;
  showPrice: boolean;
  showRating: boolean;
  variant: 'course' | 'progress' | 'cert';
}

export interface TopicsSection extends SectionFrame {
  kind: 'topics';
  title: string;
  categories: Category[];
}

export interface InstructorVideo extends Video {
  title: string;
  durationSeconds: number;
  posterUrl: string | null;
}

export interface InstructorSection extends SectionFrame {
  kind: 'instructor';
  eyebrow: string;
  title: string;
  /** `bio`: Markdown (the builder's rich text). */
  instructor: Person & { role: string; bio: string };
  stats: Stat[];
  /** Only when the school set a valid video URL — never a play button without a video. */
  video: InstructorVideo | null;
}

/** A plan card the school typed in the builder, shown when there are no real membership plans. */
export interface StaticPlan {
  name: string;
  /** Display text, e.g. "$59/mo". */
  price: string;
  description: string;
  highlighted: boolean;
  button: Cta;
}

export interface MembershipSection extends SectionFrame {
  kind: 'membership_plans';
  title: string;
  subtitle: string;
  plans: MembershipPlan[];
  annualToggle: boolean;
  staticPlans: StaticPlan[];
}

export interface TestimonialsSection extends SectionFrame {
  kind: 'testimonials';
  title: string;
  /** `rating` is null for quotes the school typed (the builder has no rating): render stars only for numbers. */
  items: { quote: string; rating: number | null; author: Person; context: string }[];
}

export interface ValuePropsSection extends SectionFrame {
  kind: 'value_props';
  title: string;
  /** `glyph` is the school's free-text icon (may be `''` → pick by position); `icon` is kept for older clients. */
  items: { icon: 'check' | 'infinity' | 'sparkle'; glyph: string; title: string; body: string }[];
}

export interface NewsletterSection extends SectionFrame {
  kind: 'newsletter';
  title: string;
  body: string;
  placeholder: string;
  /** `''` → the site's default label. */
  buttonLabel: string;
}

export interface TextSection extends SectionFrame {
  kind: 'text';
  title: string;
  /** Markdown (the builder's rich text); older plain text renders as before (single newlines are line breaks). */
  body: string;
}

export interface StatsSection extends SectionFrame {
  kind: 'stats';
  items: Stat[];
}

export interface FaqSection extends SectionFrame {
  kind: 'faq';
  title: string;
  /** `answer`: Markdown (the builder's rich text). */
  items: { question: string; answer: string }[];
}

export interface LogosSection extends SectionFrame {
  kind: 'logos';
  title: string;
  /** `imageUrl` is an https image when the school set one; otherwise the name renders as a wordmark. */
  items: { name: string; imageUrl: string | null }[];
}

export interface VideoSection extends SectionFrame {
  kind: 'video';
  caption: string;
  video: Video;
}

export interface CtaSection extends SectionFrame {
  kind: 'cta';
  title: string;
  body: string;
  button: Cta | null;
}

export interface BannerSection extends SectionFrame {
  kind: 'banner';
  title: string;
  button: Cta | null;
}

export type FormFieldType = 'text' | 'email' | 'phone' | 'long_text' | 'choice' | 'checkbox';

export interface FormField {
  /** `f1`, `f2`… — the keys of a submission's `values`. */
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  /** Choices of a `choice` field (`[]` otherwise; a choice without options is a free text field). */
  options: string[];
}

export interface FormSection extends SectionFrame {
  kind: 'form';
  title: string;
  subtitle: string;
  fields: FormField[];
  /** `''` → the site's default "Send". */
  submitLabel: string;
  note: string;
  /** Show the spam-protection note (the honeypot is always rendered). */
  captcha: boolean;
  /** Submissions are also saved as a contact in the school's Forms & leads. */
  save: boolean;
  /** Where to post: `/api/v1/pages/{slug}/forms/{sectionId}`. */
  action: string;
}

/**
 * A `form` section set to one of the school's lead forms (Forms & leads, `opt.lead_form`): the API sends this instead
 * of the builder form, and the site renders the lead form inline (docs/api/forms.md). `title`/`subtitle` are the
 * section's texts (`''` → the form's own).
 */
export interface LeadFormSection extends SectionFrame {
  kind: 'lead_form';
  formId: string;
  title: string;
  subtitle: string;
}

export interface CompareSection extends SectionFrame {
  kind: 'compare';
  title: string;
  columns: [string, string, string];
  /** The highlighted column (the middle plan). */
  highlight: number;
  /** Cells: `✓` (included), `—` (not included) or text. */
  rows: { feature: string; values: [string, string, string] }[];
}

export interface QuoteSection extends SectionFrame {
  kind: 'quote';
  text: string;
  name: string;
  meta: string;
  author: Person;
}

export type Section =
  | HeroSection
  | FeaturedCoursesSection
  | TopicsSection
  | InstructorSection
  | MembershipSection
  | TestimonialsSection
  | ValuePropsSection
  | NewsletterSection
  | TextSection
  | StatsSection
  | FaqSection
  | LogosSection
  | VideoSection
  | CtaSection
  | BannerSection
  | FormSection
  | LeadFormSection
  | CompareSection
  | QuoteSection;

export type SectionKind = Section['kind'];

/** `GET /api/v1/pages/{slug}` */
export interface Page {
  slug: string;
  title: string;
  seo: { title: string | null; description: string | null; ogImageUrl: string | null; noindex: boolean };
  sections: Section[];
  updatedAt: string;
}

/** Why a page can't be shown to this visitor (401/403 `code`s of `GET /pages/{slug}`). */
export type PageGate = 'page_password_required' | 'members_only' | 'members_only_forbidden';

/** `POST /api/v1/pages/{slug}/forms/{sectionId}` body: keys are field ids; checkboxes are booleans. */
export interface FormSubmission {
  values: Record<string, string | boolean>;
  /** The honeypot. People leave it empty. */
  website: string;
}
