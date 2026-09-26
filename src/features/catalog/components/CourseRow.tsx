import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import type { CourseSummary } from '../types';
import styles from './CourseCard.module.css';
import { CourseCover } from './CourseCover';
import { RowState } from './CourseCardState';

/** Catalogue list-view row. */
export function CourseRow({ course }: { course: CourseSummary }) {
  const t = useTranslations('common');
  const f = useFormat();
  return (
    <article className={`${styles.card} ${styles.row}`}>
      <CourseCover cover={course.cover} height={88} radius={10} className={styles.rowCover} sizes="150px" />
      <div className={styles.rowBody}>
        <div className={styles.topRow} style={{ justifyContent: 'flex-start' }}>
          <span className="eyebrow eyebrow-brand">{course.category.name}</span>
          <span className="tag tag-soft">{t(`levels.${course.level}`)}</span>
        </div>
        <h3 className={styles.title} style={{ marginTop: 4 }}>
          <Link href={routes.course(course.slug)} className={styles.stretched}>
            {course.title}
          </Link>
        </h3>
        <p className={styles.meta} style={{ marginTop: 5 }}>
          {course.instructor.name}
          <span aria-hidden="true">·</span>
          <span className="stars" aria-hidden="true">
            ★
          </span>
          <span className="sr-only">{t('ratingLabel', { rating: course.rating })}</span>
          <span aria-hidden="true">{course.rating.toFixed(1)}</span>
          <span aria-hidden="true">·</span>
          {t('lessons', { count: course.lessonCount })}
          <span aria-hidden="true">·</span>
          {f.duration(course.durationMinutes)}
        </p>
      </div>
      <RowState slug={course.slug} price={f.money(course.price)} />
    </article>
  );
}
