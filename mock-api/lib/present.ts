/** Row → API resource. Business rules that the UI must not recompute (progress, prices, locks) live here. */
import type { CourseDetail, CourseSummary, LessonOutline } from '@/features/catalog/types';
import type { MembershipPlan } from '@/features/membership/types';
import type { Enrollment, LessonRef, Progress } from '@/features/learning/types';
import type { Money, Person } from '@/lib/api/types';
import { initials } from './db';
import type { CourseRow, LessonRow, TenantData, UserRow } from './records';

export const money = (t: TenantData, amount: number): Money => ({ amount: Math.round(amount), currency: t.site.currency });

export const person = (name: string, color: string): Person => ({ name, initials: initials(name), avatarUrl: null, color });

const lessonCount = (c: CourseRow) => c.modules.reduce((n, m) => n + m.lessons.length, 0);
export const allLessons = (c: CourseRow) => c.modules.flatMap((m) => m.lessons.map((l) => ({ lesson: l, module: m })));

/** Instalment plan: three payments with a small surcharge, rounded up to whole units — as the design prices it. */
export const installmentAmount = (total: number) => Math.ceil(total / 3 / 100 + 5) * 100;

export function courseSummary(t: TenantData, c: CourseRow): CourseSummary {
  const cat = t.categories.find((x) => x.slug === c.categorySlug)!;
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    excerpt: c.excerpt,
    category: { slug: cat.slug, name: cat.name },
    cover: { url: null, color: c.coverColor, alt: c.title },
    level: c.level,
    instructor: person(t.instructor.name, t.instructor.color),
    rating: c.rating,
    reviewCount: c.reviewCount,
    studentCount: c.studentCount,
    lessonCount: lessonCount(c),
    durationMinutes: c.durationMinutes,
    price: money(t, c.price),
    paymentPlan: { installments: 3, installmentPrice: money(t, installmentAmount(c.price)) },
    featured: c.featured,
    updatedAt: c.updatedAt,
  };
}

const outline = (l: LessonRow): LessonOutline => ({
  id: l.id,
  title: l.title,
  type: l.type,
  durationSeconds: l.durationSeconds,
  questionCount: l.type === 'quiz' ? l.questions.length : null,
  freePreview: l.freePreview,
});

export function courseDetail(t: TenantData, c: CourseRow): CourseDetail {
  const preview = allLessons(c).find((x) => x.lesson.freePreview)?.lesson;
  return {
    ...courseSummary(t, c),
    description: c.description,
    outcomes: c.outcomes,
    requirements: c.requirements,
    audience: c.audience,
    faqs: c.faqs,
    modules: c.modules.map((m) => ({ id: m.id, title: m.title, lessons: m.lessons.map(outline) })),
    instructorProfile: { role: t.instructor.role, bio: t.instructor.bio, studentCount: t.instructor.studentCount },
    guaranteeDays: t.membership.guaranteeDays,
    certificate: t.site.features.certificates,
    community: t.site.features.community,
    preview: preview ? { lessonId: preview.id, title: preview.title, posterUrl: null } : null,
    reviews: t.reviews
      .filter((r) => r.courseId === c.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ id: r.id, author: person(r.name, r.color), rating: r.rating, body: r.body, createdAt: r.createdAt })),
    ratingDistribution: [
      { stars: 5, percent: 78 },
      { stars: 4, percent: 15 },
      { stars: 3, percent: 5 },
      { stars: 2, percent: 2 },
      { stars: 1, percent: 0 },
    ],
    includedInPlan: (() => {
      const p = t.site.features.membership ? t.membership.plans.find((x) => x.id === 'plan_pro') : undefined;
      return p ? { planId: p.id, planName: p.name, perMonth: money(t, p.monthly) } : null;
    })(),
    related: t.courses
      .filter((x) => x.id !== c.id)
      .slice(0, 3)
      .map((x) => courseSummary(t, x)),
    language: t.site.defaultLocale,
    publishedAt: c.publishedAt,
  };
}

export function membershipPlans(t: TenantData): MembershipPlan[] {
  const annual = (m: number) => Math.round((m * (100 - t.membership.annualDiscountPercent)) / 100 / 100) * 100;
  return t.membership.plans.map((p) => ({
    id: p.id,
    name: p.name,
    summary: p.summary,
    features: p.features,
    popular: p.popular,
    prices: [
      { interval: 'month', perMonth: money(t, p.monthly), billed: money(t, p.monthly) },
      { interval: 'year', perMonth: money(t, annual(p.monthly)), billed: money(t, annual(p.monthly) * 12) },
    ],
  }));
}

export const completedSet = (t: TenantData, userId: string) =>
  new Set(t.completions.filter((x) => x.userId === userId).map((x) => x.lessonId));

export function progressOf(c: CourseRow, done: Set<string>): Progress {
  const total = lessonCount(c);
  const completed = allLessons(c).filter((x) => done.has(x.lesson.id)).length;
  return { completed, total, percent: total ? Math.round((completed / total) * 100) : 0 };
}

export const lessonRef = (l: LessonRow, moduleTitle: string): LessonRef => ({
  id: l.id,
  title: l.title,
  type: l.type,
  durationSeconds: l.durationSeconds,
  questionCount: l.type === 'quiz' ? l.questions.length : null,
  moduleTitle,
});

export function resumeLesson(c: CourseRow, done: Set<string>): LessonRef {
  const all = allLessons(c);
  const next = all.find((x) => !done.has(x.lesson.id)) ?? all[0]!;
  return lessonRef(next.lesson, next.module.title);
}

export const isEnrolled = (t: TenantData, user: UserRow | null, courseId: string) =>
  !!user && (t.enrollments.some((e) => e.userId === user.id && e.courseId === courseId) || hasAllAccessPlan(t, user));

/** Pro and Inner Circle unlock every course; Starter unlocks the first two. */
export function hasAllAccessPlan(t: TenantData, user: UserRow) {
  return user.membershipPlanId !== null && user.membershipPlanId !== 'plan_starter' && t.site.features.membership;
}

export function enrolledCourses(t: TenantData, user: UserRow): CourseRow[] {
  if (hasAllAccessPlan(t, user)) return t.courses;
  const ids = new Set(t.enrollments.filter((e) => e.userId === user.id).map((e) => e.courseId));
  if (user.membershipPlanId === 'plan_starter') t.courses.slice(0, 2).forEach((c) => ids.add(c.id));
  return t.courses.filter((c) => ids.has(c.id));
}

export function enrollment(t: TenantData, user: UserRow, c: CourseRow): Enrollment {
  const done = completedSet(t, user.id);
  const progress = progressOf(c, done);
  const row = t.enrollments.find((e) => e.userId === user.id && e.courseId === c.id);
  const lastDone = t.completions
    .filter((x) => x.userId === user.id && allLessons(c).some((a) => a.lesson.id === x.lessonId))
    .map((x) => x.at)
    .sort()
    .at(-1);
  return {
    courseId: c.id,
    courseSlug: c.slug,
    courseTitle: c.title,
    cover: { url: null, color: c.coverColor, alt: c.title },
    progress,
    resumeLesson: resumeLesson(c, done),
    completedAt: progress.percent === 100 ? (lastDone ?? null) : null,
    enrolledAt: row?.enrolledAt ?? user.createdAt,
  };
}

export function findLesson(t: TenantData, lessonId: string) {
  for (const c of t.courses)
    for (const m of c.modules) {
      const l = m.lessons.find((x) => x.id === lessonId);
      if (l) return { course: c, module: m, lesson: l };
    }
  return null;
}
