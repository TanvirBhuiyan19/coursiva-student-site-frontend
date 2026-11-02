'use client';
import { useTranslations } from 'next-intl';
import type { Paginated } from '@/lib/api/types';
import { useInstructorPages } from '../api';
import type { InstructorSummary } from '../types';
import { InstructorCard } from './InstructorCard';
import styles from './Instructors.module.css';

/**
 * The instructor index grid. Page 1 is in the server HTML (what crawlers index — the sitemap lists every profile);
 * further pages load in place with "Show more".
 */
export function InstructorGrid({ first }: { first: Paginated<InstructorSummary> }) {
  const t = useTranslations('instructors');
  const tc = useTranslations('common');
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isError } = useInstructorPages(first);
  const instructors = data.pages.flatMap((p) => p.data);
  if (instructors.length === 0) return <p className={styles.empty}>{t('empty')}</p>;
  return (
    <>
      <ul className={`grid-3 ${styles.grid}`}>
        {instructors.map((p) => (
          <li key={p.slug}>
            <InstructorCard instructor={p} />
          </li>
        ))}
      </ul>
      {(hasNextPage || isError) && (
        <div className={styles.more}>
          {isError && (
            <p className="field-error" role="alert">
              {t('loadFailed')}
            </p>
          )}
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            aria-busy={isFetchingNextPage}
          >
            {isFetchingNextPage ? tc('loading') : isError ? tc('retry') : t('showMore')}
          </button>
        </div>
      )}
    </>
  );
}
