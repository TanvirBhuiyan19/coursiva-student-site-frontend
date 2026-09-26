/** Public catalogue. Contract: docs/api/catalog.md */
import type { Cover, Money, Person } from '@/lib/api/types';

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
  category: CategoryRef;
  cover: Cover;
  level: Level;
  instructor: Person;
  rating: number;
  reviewCount: number;
  studentCount: number;
  lessonCount: number;
  durationMinutes: number;
  price: Money;
  /** Set when the tenant offers an instalment plan for this course. Computed by the API (one owner). */
  paymentPlan: PaymentPlan | null;
  /** The storefront's "Most popular" pick; at most one course has it. */
  featured: boolean;
  updatedAt: string;
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
  instructorProfile: { role: string; bio: string; studentCount: number };
  guaranteeDays: number;
  certificate: boolean;
  community: boolean;
  /** Free-preview lesson shown in the preview modal (first lesson flagged `freePreview`). */
  preview: { lessonId: string; title: string; posterUrl: string | null } | null;
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
