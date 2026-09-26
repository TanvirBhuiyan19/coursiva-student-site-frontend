'use client';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useEnrollmentFor } from '@/features/learning/api';
import { routes } from '@/lib/routes';
import styles from './CourseCard.module.css';

/** "ENROLLED" / "COMPLETED" ribbon on the cover — only for enrolled learners. */
export function CardEnrolledBadge({ slug }: { slug: string }) {
  const t = useTranslations('catalog');
  const e = useEnrollmentFor(slug);
  if (!e) return null;
  return <span className={`tag tag-ok ${styles.badge}`}>{e.progress.percent === 100 ? t('completed') : t('enrolled')}</span>;
}

/** Guests see price + "View →". Enrolled learners see progress (catalog) or Continue/Completed (featured). */
export function CardFooterState({ slug, price, variant }: { slug: string; price: string; variant: 'featured' | 'catalog' }) {
  const t = useTranslations('catalog');
  const e = useEnrollmentFor(slug);

  if (e && variant === 'catalog') {
    return (
      <div className={styles.progressRow}>
        <div
          className="progress"
          role="progressbar"
          aria-valuenow={e.progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('progressLabel')}
        >
          <span style={{ width: `${e.progress.percent}%` }} />
        </div>
        <span className={styles.pct}>{e.progress.percent}%</span>
      </div>
    );
  }

  const done = e?.progress.percent === 100;
  return (
    <div className={styles.footer}>
      <span className={styles.price}>{price}</span>
      {e ? (
        <Link href={routes.player(slug)} className={styles.state} data-done={done}>
          {done ? t('completedCta') : t('continueCta')}
        </Link>
      ) : (
        <span className={styles.state} aria-hidden="true">
          {t('viewCta')}
        </span>
      )}
    </div>
  );
}

/** List-view right-hand column. */
export function RowState({ slug, price }: { slug: string; price: string }) {
  const t = useTranslations('catalog');
  const e = useEnrollmentFor(slug);
  return (
    <div className={styles.rowEnd}>
      {e ? (
        <span className={styles.rowEnrolled}>{t('enrolledPct', { percent: e.progress.percent })}</span>
      ) : (
        <>
          <span className={styles.price} style={{ fontSize: 19 }}>
            {price}
          </span>
          <span className={styles.state} aria-hidden="true" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
            {t('viewCta')}
          </span>
        </>
      )}
    </div>
  );
}
