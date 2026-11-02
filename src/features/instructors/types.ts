/** Public instructor profiles (`/instructors`, `/instructors/{slug}`). Contract: docs/api/instructors.md */
import type { CourseSummary } from '@/features/catalog/types';

export interface InstructorStats {
  /** Distinct learners with a live (active/completed) enrolment in the instructor's catalogue courses. */
  learnerCount: number;
  /** The instructor's published, public courses (the ones the profile lists). */
  courseCount: number;
  /** Mean of every review of those courses, 1 decimal; null without reviews. */
  rating: number | null;
  reviewCount: number;
}

export type InstructorPlatform = 'linkedin' | 'x' | 'youtube' | 'instagram' | 'facebook' | 'tiktok' | 'github';

export interface InstructorSocialLink {
  platform: InstructorPlatform;
  /** https:// on the platform's own domain (checked by the API). */
  url: string;
}

export interface InstructorCredential {
  title: string;
  /** '' when not given. */
  issuer: string;
  year: number | null;
}

/** A card on the index (and the head of the profile page). */
export interface InstructorSummary {
  slug: string;
  name: string;
  /** Up to 2 letters, for the placeholder avatar. */
  initials: string;
  /** Placeholder avatar colour (OKLCH L ≤ 0.55 — white text passes 4.5:1). */
  color: string;
  /** Absolute public image URL (with `?v=…`), rendered straight from there. */
  avatarUrl: string | null;
  /** May be ''. */
  headline: string;
  /** ≤ 12 tags, display order. */
  expertise: string[];
  stats: InstructorStats;
}

/** `GET /api/v1/instructors/{slug}` */
export interface InstructorDetail extends InstructorSummary {
  /** Wide banner image (absolute, `?v=…`); null → the page uses `color`. */
  coverUrl: string | null;
  /**
   * Safe HTML rendered by the API from the instructor's Markdown (CommonMark elements only, raw HTML stripped, images
   * removed, unsafe links dropped) — inserted as-is ('' when empty).
   */
  bioHtml: string;
  /** Plain text, ≤ 280 chars. */
  bioExcerpt: string;
  /** ≤ 10. */
  credentials: InstructorCredential[];
  /** ≤ 7, one per platform. */
  socialLinks: InstructorSocialLink[];
  /** https:// URL. */
  website: string | null;
  /** The catalogue card shape, newest first, ≤ 50. */
  courses: CourseSummary[];
  seo: {
    /** The profile's SEO title, else its name (the school's title template applies). */
    title: string;
    /** SEO description, else the bio's first 160 chars, else the headline ('' possible). */
    description: string;
    /** Share image: the cover, else the avatar; null → the site's generated og image. */
    imageUrl: string | null;
  };
  /** Sitemap lastmod. */
  updatedAt: string | null;
}

/** `GET /api/v1/redirects/resolve?path=…` — a former address (SEO redirect or renamed profile). */
export interface RedirectTarget {
  to: string;
  status: 301 | 302;
}
