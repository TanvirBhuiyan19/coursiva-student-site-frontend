import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';
import type { InstructorSummary } from '../types';
import { InstructorAvatar } from './InstructorAvatar';
import styles from './Instructors.module.css';

/** A card on `/instructors`: photo, name (the link covers the card), headline, figures and the first expertise tags. */
export function InstructorCard({ instructor: p }: { instructor: InstructorSummary }) {
  const t = useTranslations('instructors');
  const tc = useTranslations('common');
  const tags = p.expertise.slice(0, 3);
  return (
    <article className={styles.card}>
      <InstructorAvatar person={p} size={64} fontSize={22} />
      <div className={styles.cardBody}>
        <h2 className={styles.cardName}>
          <Link href={routes.instructor(p.slug)} className={styles.stretched}>
            {p.name}
          </Link>
        </h2>
        {p.headline !== '' && <p className={styles.cardHeadline}>{p.headline}</p>}
        <p className={styles.cardMeta}>
          <span>{t('courses', { count: p.stats.courseCount })}</span>
          <span aria-hidden="true">·</span>
          <span>{t('learners', { count: p.stats.learnerCount })}</span>
          {p.stats.rating !== null && p.stats.reviewCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                <span className="stars" aria-hidden="true">
                  ★
                </span>
                <span className="sr-only">{tc('ratingLabel', { rating: p.stats.rating.toFixed(1) })}</span>
                <span aria-hidden="true"> {p.stats.rating.toFixed(1)}</span>
              </span>
            </>
          )}
        </p>
        {tags.length > 0 && (
          <ul className={styles.cardTags} aria-label={t('expertise')}>
            {tags.map((tag) => (
              <li key={tag} className="tag tag-soft">
                {tag}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
