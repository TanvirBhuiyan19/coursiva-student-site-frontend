/** Public catalogue. Contract: docs/api/catalog.md */
import type { Cover, Money, Person } from '@/lib/api/types';
import type { LearnerBlock, VideoBlock } from '@/features/learning/types';

export type Level = 'beginner' | 'intermediate' | 'advanced' | 'all_levels';
export type LessonType = 'video' | 'pdf' | 'quiz' | 'text' | 'live';

export interface CategoryRef {
  slug: string;
  name: string;
}

export interface Category extends CategoryRef {
  courseCount: number;
  /** Swatch colour for topic chips. */
  color: string;
}

export interface CourseSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  /** null for a course the school hasn't put in a category. */
  category: CategoryRef | null;
  cover: Cover;
  level: Level;
  /**
   * With a published instructor profile: the profile's name and photo, and `slug` (link to `/instructors/{slug}`).
   * Otherwise the member's name, no photo and `slug: null` (plain text, no link). docs/api/instructors.md
   */
  instructor: CourseInstructor;
  rating: number;
  reviewCount: number;
  studentCount: number;
  lessonCount: number;
  durationMinutes: number;
  /**
   * What one purchase costs: a subscription course's price per `pricing.interval`, a pay-what-you-want course's
   * suggested price (the learner may pay any amount from `pricing.minimumPrice`).
   */
  price: Money;
  /** How the course sells; checkout honours it (docs/api/catalog.md → Pricing models). */
  pricing: CoursePricing;
  /** Set when the tenant offers an instalment plan for this course. Computed by the API (one owner). */
  paymentPlan: PaymentPlan | null;
  /** The storefront's "Most popular" pick; at most one course has it. */
  featured: boolean;
  updatedAt: string;
}

export type CourseInstructor = Person & { slug: string | null };

export type PricingModel = 'one_time' | 'payment_plan' | 'subscription' | 'membership' | 'pay_what_you_want' | 'free';

/**
 * `subscription`: billed every `interval` until cancelled (bought from the course page only, never as a gift or team
 * seats). `pay_what_you_want`: the learner picks the amount at checkout, at least `minimumPrice`. `membership`: not
 * sold on its own — it comes with a membership plan (`includedInPlan`). Only `one_time` and `payment_plan` courses
 * go in the cart.
 */
export interface CoursePricing {
  model: PricingModel;
  interval: 'month' | null;
  minimumPrice: Money | null;
}

/**
 * The course page's instructor block, filled from the instructor's published profile (`bio` = its plain-text excerpt,
 * `studentCount` = its learner count, the rest its stats). Without one: `bio: ''`, `studentCount: 0`, `slug: null`,
 * `headline: ''`, `courseCount: 0`, `rating: null`, `reviewCount: 0` — the page shows the name only.
 */
export interface InstructorProfile {
  role: string;
  bio: string;
  studentCount: number;
  slug: string | null;
  headline: string;
  courseCount: number;
  rating: number | null;
  reviewCount: number;
}

export interface PaymentPlan {
  installments: number;
  installmentPrice: Money;
}

export interface LessonOutline {
  id: string;
  title: string;
  type: LessonType;
  durationSeconds: number | null;
  questionCount: number | null;
  freePreview: boolean;
  /** A sentence or two about the lesson, shown when its outline row is expanded (null: none). */
  summary?: string | null;
}

export interface ModuleOutline {
  id: string;
  title: string;
  lessons: LessonOutline[];
}

export interface Review {
  id: string;
  author: Person;
  rating: number;
  body: string;
  createdAt: string;
}

export interface CourseDetail extends CourseSummary {
  description: string;
  outcomes: string[];
  requirements: string[];
  audience: string[];
  faqs: { question: string; answer: string }[];
  modules: ModuleOutline[];
  instructorProfile: InstructorProfile;
  guaranteeDays: number;
  certificate: boolean;
  community: boolean;
  /** The first free-preview lesson (kept for older clients; `previews[0]`). */
  preview: { lessonId: string; title: string; type: LessonType; posterUrl: string | null } | null;
  /**
   * Every free-preview lesson, in curriculum order: each opens in the guest preview modal (`CoursePreview`). Optional
   * for older APIs (the page falls back to `preview`).
   */
  previews?: PreviewItem[];
  reviews: Review[];
  /** Share of reviews per star value, 5 → 1. Percentages computed by the API. */
  ratingDistribution: { stars: number; percent: number }[];
  /** Cheapest membership plan that unlocks this course, if the tenant sells memberships. */
  includedInPlan: { planId: string; planName: string; perMonth: Money } | null;
  related: CourseSummary[];
  language: string;
  publishedAt: string;
  updatedAt: string;
}

export interface Bundle {
  slug: string;
  title: string;
  /** The bundle product's Markdown, shown as plain text on the card. */
  description: string;
  courseSlugs: string[];
  price: Money;
  compareAtPrice: Money;
  savingsPercent: number;
}

/** `GET /api/v1/courses` */
export interface Catalog {
  courses: CourseSummary[];
  categories: Category[];
  bundles: Bundle[];
}

/** One of a course's free previews (`CourseDetail.previews`). */
export interface PreviewItem {
  lessonId: string;
  title: string;
  type: LessonType;
  durationSeconds: number | null;
  posterUrl: string | null;
}

/** The stored lesson type of a preview: it picks the viewer (`type` is the coarser learner type). */
export type LessonFormat =
  | 'video'
  | 'audio'
  | 'text'
  | 'pdf'
  | 'document'
  | 'files'
  | 'external'
  | 'embed'
  | 'quiz'
  | 'assignment'
  | 'survey'
  | 'live'
  | 'scorm'
  | 'coaching'
  | 'checkpoint';

/** What's inside a quiz, assignment, survey, checkpoint, live, SCORM or coaching lesson (null where it doesn't apply). */
export interface PreviewSummary {
  kind: LessonFormat;
  questionCount: number | null;
  passPercent: number | null;
  timeLimitMinutes: number | null;
  attemptsAllowed: number | null;
  points: number | null;
  startsAt: string | null;
  durationMinutes: number | null;
}

/**
 * `GET /api/v1/courses/{slug}/preview?lesson={id}` — a free-preview lesson as a guest gets it (no session needed).
 * Its URLs are signed and short-lived, so the response is `Cache-Control: private, no-store` and the site fetches it in
 * the browser only while the preview is open. Older APIs send only the video keys (the rest are optional here).
 */
export interface CoursePreview {
  lessonId: string;
  title: string;
  type: LessonType;
  format?: LessonFormat;
  durationSeconds: number | null;
  posterUrl: string | null;
  /** Video, audio and embed lessons (the lesson payload's `video`, never a watermark); null otherwise. */
  video: VideoBlock | null;
  /** The lesson's content blocks (as on `GET /me/lessons/{id}`); null/absent without a body. */
  blocks?: LearnerBlock[] | null;
  /** Blocks after the first continue gate, withheld from the preview (a guest passes no gates). */
  blocksLocked?: number;
  /** The lesson's own Markdown as safe HTML (a text body, an assignment's instructions, a survey's intro). */
  bodyHtml?: string | null;
  /** A PDF lesson's PDF for the inline viewer; `downloadable` false = view only. */
  pdf?: { url: string; name: string; sizeBytes: number; downloadable: boolean } | null;
  /** A Document lesson's file: `url` null when guests can't download it. */
  file?: { name: string; sizeBytes: number; url: string | null } | null;
  link?: { url: string; newTab: boolean } | null;
  resources?: { id: string; kind: 'pdf' | 'slides' | 'file'; name: string; sizeBytes: number; url: string | null }[];
  summary?: PreviewSummary | null;
  course: { slug: string; title: string };
}
