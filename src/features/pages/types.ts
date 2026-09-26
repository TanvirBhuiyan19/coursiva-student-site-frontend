/**
 * Site-builder pages. The tenant composes their home page from sections in the dashboard's site builder; the API
 * returns them resolved (courses, plans and stats already looked up). Contract: docs/api/pages.md
 */
import type { CourseSummary, Category } from '@/features/catalog/types';
import type { MembershipPlan } from '@/features/membership/types';
import type { Person } from '@/lib/api/types';

export interface Cta {
  label: string;
  href: string;
}

export interface Stat {
  value: string;
  label: string;
}

interface SectionBase {
  id: string;
}

export interface HeroSection extends SectionBase {
  kind: 'hero';
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryCta: Cta;
  secondaryCta: Cta | null;
  stats: Stat[];
  spotlight: CourseSummary | null;
}

export interface FeaturedCoursesSection extends SectionBase {
  kind: 'featured_courses';
  title: string;
  courses: CourseSummary[];
}

export interface TopicsSection extends SectionBase {
  kind: 'topics';
  title: string;
  categories: Category[];
}

export interface InstructorSection extends SectionBase {
  kind: 'instructor';
  eyebrow: string;
  title: string;
  instructor: Person & { role: string; bio: string };
  stats: Stat[];
  video: { title: string; durationSeconds: number; posterUrl: string | null } | null;
}

export interface MembershipSection extends SectionBase {
  kind: 'membership_plans';
  title: string;
  subtitle: string;
  plans: MembershipPlan[];
}

export interface TestimonialsSection extends SectionBase {
  kind: 'testimonials';
  title: string;
  items: { quote: string; rating: number; author: Person; context: string }[];
}

export interface ValuePropsSection extends SectionBase {
  kind: 'value_props';
  items: { icon: 'check' | 'infinity' | 'sparkle'; title: string; body: string }[];
}

export interface NewsletterSection extends SectionBase {
  kind: 'newsletter';
  title: string;
  body: string;
}

export type Section =
  | HeroSection
  | FeaturedCoursesSection
  | TopicsSection
  | InstructorSection
  | MembershipSection
  | TestimonialsSection
  | ValuePropsSection
  | NewsletterSection;

/** `GET /api/v1/pages/{slug}` */
export interface Page {
  slug: string;
  title: string;
  seo: { title: string | null; description: string | null };
  sections: Section[];
  updatedAt: string;
}
