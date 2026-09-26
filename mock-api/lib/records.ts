/**
 * Storage rows for the mock backend. These are "database" shapes — routes turn them into the API resources defined
 * in src/features/<feature>/types.ts (the contract). Laravel will own the real tables.
 */
import type { Level, LessonType } from '@/features/catalog/types';
import type { Site, TenantResolution } from '@/features/tenant/types';
import type { Membership } from '@/features/membership/types';
import type { SocialNetwork } from '@/features/tenant/types';

export interface QuizQuestionRow {
  id: string;
  prompt: string;
  options: string[];
  answer: number;
}

export interface LessonRow {
  id: string;
  title: string;
  type: LessonType;
  durationSeconds: number | null;
  freePreview: boolean;
  questions: QuizQuestionRow[];
  pdfSizeBytes: number | null;
}

export interface ModuleRow {
  id: string;
  title: string;
  lessons: LessonRow[];
}

export interface CourseRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  description: string;
  categorySlug: string;
  coverColor: string;
  level: Level;
  /** Minor units. */
  price: number;
  rating: number;
  reviewCount: number;
  studentCount: number;
  durationMinutes: number;
  outcomes: string[];
  requirements: string[];
  audience: string[];
  faqs: { question: string; answer: string }[];
  modules: ModuleRow[];
  featured: boolean;
  publishedAt: string;
  updatedAt: string;
}

export interface CategoryRow {
  slug: string;
  name: string;
  color: string;
}

export interface InstructorRow {
  name: string;
  initials: string;
  color: string;
  role: string;
  bio: string;
  studentCount: number;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password: string;
  color: string;
  bio: string;
  createdAt: string;
  timezone: string;
  website: string;
  preferences: { newLessons: boolean; communityReplies: boolean; liveReminders: boolean };
  card: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  membershipRenewsAt: string | null;
  weeklyGoal: number;
  streakDays: number;
  /** Lessons completed per day for the current week, Monday first (seeded activity). */
  weekActivity: number[];
  membershipPlanId: string | null;
}

export interface ReviewRow {
  id: string;
  courseId: string;
  userId: string | null;
  name: string;
  color: string;
  rating: number;
  body: string;
  createdAt: string;
}

export interface OrderRow {
  id: string;
  number: string;
  userId: string;
  createdAt: string;
  items: {
    kind: 'course' | 'membership' | 'bundle';
    refId: string;
    title: string;
    coverColor: string;
    meta: string;
    unitPrice: number;
    quantity: number;
  }[];
  subtotal: number;
  discount: number;
  couponCode: string | null;
  orderBump: number;
  tax: number;
  taxRatePercent: number;
  total: number;
  /** Charged today (differs from total for instalment plans). */
  dueToday: number;
  plan: { installments: number; installmentAmount: number } | null;
  paymentMethod: string;
  gift: { recipientEmail: string; message: string; claimUrl: string } | null;
  seats: { quantity: number; claimUrls: string[] } | null;
  billing: { name: string; email: string; country: string };
  status: 'paid' | 'pending';
}

export interface PostRow {
  id: string;
  spaceId: string;
  userId: string | null;
  name: string;
  color: string;
  isCoach: boolean;
  body: string;
  likes: number;
  replies: number;
  createdAt: string;
}

export interface SpaceRow {
  id: string;
  name: string;
  group: string;
  access: 'public' | 'members' | 'course' | 'cohort' | 'paid';
  courseId: string | null;
  description: string;
}

export interface TenantData {
  resolution: TenantResolution;
  site: Site;
  instructor: InstructorRow;
  categories: CategoryRow[];
  courses: CourseRow[];
  bundles: { slug: string; title: string; description: string; courseSlugs: string[]; price: number }[];
  orderBump: { title: string; description: string; price: number } | null;
  orderPrefix: string;
  membership: Omit<Membership, 'plans'> & {
    plans: { id: string; name: string; summary: string; features: string[]; popular: boolean; monthly: number }[];
  };
  home: {
    hero: { eyebrow: string; title: string; subtitle: string };
    instructorVideo: { title: string; durationSeconds: number };
    testimonials: { quote: string; rating: number; name: string; color: string; courseSlug: string }[];
    valueProps: { icon: 'check' | 'infinity' | 'sparkle'; title: string; body: string }[];
    newsletter: { title: string; body: string };
    membership: { title: string; subtitle: string };
  };
  help: { title: string; articles: string[] }[];
  legal: Record<
    'refund' | 'privacy' | 'terms',
    { title: string; updatedAt: string; intro: string; sections: { heading: string; body: string }[] }
  >;
  footerSocial: SocialNetwork[];
  users: UserRow[];
  enrollments: { userId: string; courseId: string; enrolledAt: string; orderId: string | null }[];
  completions: { userId: string; lessonId: string; at: string }[];
  notes: { userId: string; lessonId: string; body: string }[];
  quizAttempts: { userId: string; lessonId: string; answers: Record<string, number>; scorePercent: number; passed: boolean; at: string }[];
  lessonQuestions: {
    id: string;
    lessonId: string;
    userId: string | null;
    name: string;
    color: string;
    isCoach: boolean;
    body: string;
    createdAt: string;
  }[];
  reviews: ReviewRow[];
  wishlist: { userId: string; courseId: string }[];
  carts: { owner: string; courseIds: string[] }[];
  orders: OrderRow[];
  spaces: SpaceRow[];
  posts: PostRow[];
  likes: { userId: string; postId: string }[];
  event: { id: string; title: string; startsAt: string; provider: 'zoom' | 'google_meet' | 'teams' | 'built_in'; attendees: number };
  rsvps: { userId: string; eventId: string }[];
  leaderboard: { name: string; points: number; color: string }[];
  notifications: { id: string; userId: string; text: string; href: string; createdAt: string; readAt: string | null }[];
  certificates: { id: string; userId: string; courseId: string; issuedAt: string }[];
  tickets: { id: string; userId: string | null; email: string; topic: string; message: string; createdAt: string }[];
  newsletter: string[];
  passwordResets: string[];
}
