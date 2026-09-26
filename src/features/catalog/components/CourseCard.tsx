import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import type { CourseSummary } from '../types';
import { CourseCover } from './CourseCover';
import styles from './CourseCard.module.css';
import { CardEnrolledBadge, CardFooterState } from './CourseCardState';

/**
 * Course card. Server-rendered for every visitor (so it's crawlable and cacheable); the enrolment state — badge,
 * progress, "Continue" — is layered on in the browser by CourseCardState. The title link covers the whole card.
 */
export function CourseCard({
  course,
  variant = 'catalog',
  headingLevel = 3,
}: {
  course: CourseSummary;
  variant?: 'featured' | 'catalog';
  headingLevel?: 2 | 3;
}) {
  const t = useTranslations('common');
  const f = useFormat();
  const H = `h${headingLevel}` as const;
  return (
    <article className={styles.card} data-variant={variant}>
      <CourseCover cover={course.cover} height={variant === 'featured' ? 120 : 120}>
        {variant === 'catalog' && <CardEnrolledBadge slug={course.slug} />}
      </CourseCover>
      <div className={styles.body}>
        <div className={styles.topRow}>
          <span className="eyebrow eyebrow-brand">{course.category.name}</span>
          {variant === 'catalog' && <span className="tag tag-soft">{t(`levels.${course.level}`)}</span>}
        </div>
        <H className={styles.title}>
          <Link href={routes.course(course.slug)} className={styles.stretched}>
            {course.title}
          </Link>
        </H>
        {variant === 'catalog' && (
          <div className={styles.instructor}>
            <span
              className="avatar"
              style={{ width: 18, height: 18, fontSize: 7.5, background: course.instructor.color }}
              aria-hidden="true"
            >
              {course.instructor.initials}
            </span>
            {course.instructor.name}
          </div>
        )}
        <p className={styles.meta}>
          <span className="stars" aria-hidden="true">
            ★
          </span>
          <span className="sr-only">{t('ratingLabel', { rating: course.rating })}</span>
          <span aria-hidden="true">{course.rating.toFixed(1)}</span>
          <span aria-hidden="true">·</span>
          {variant === 'featured' ? t('students', { count: course.studentCount }) : t('lessons', { count: course.lessonCount })}
          <span aria-hidden="true">·</span>
          {f.duration(course.durationMinutes)}
        </p>
        <CardFooterState slug={course.slug} price={f.money(course.price)} variant={variant} />
      </div>
    </article>
  );
}

/** Small "students also take" card. */
export function CourseMiniCard({ course }: { course: CourseSummary }) {
  const t = useTranslations('common');
  const f = useFormat();
  return (
    <article className={styles.card}>
      <CourseCover cover={course.cover} height={90} />
      <div className={styles.miniBody}>
        <h3 className={styles.miniTitle}>
          <Link href={routes.course(course.slug)} className={styles.stretched}>
            {course.title}
          </Link>
        </h3>
        <div className={styles.miniRow}>
          <span className={styles.meta} style={{ marginTop: 0 }}>
            <span className="stars" aria-hidden="true">
              ★
            </span>
            <span className="sr-only">{t('ratingLabel', { rating: course.rating })}</span>
            <span aria-hidden="true">{course.rating.toFixed(1)}</span>
            <span aria-hidden="true">·</span>
            {t('students', { count: course.studentCount })}
          </span>
          <span className={styles.miniPrice}>{f.money(course.price)}</span>
        </div>
      </div>
    </article>
  );
}
