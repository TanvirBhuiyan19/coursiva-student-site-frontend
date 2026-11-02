'use client';
import { Link } from '@/i18n/navigation';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useDeferredValue, useId, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import type { Money } from '@/lib/api/types';
import { markdownToPlain } from '@/lib/markdown';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import type { Catalog, CourseSummary } from '../types';
import { CourseCard } from './CourseCard';
import { CourseCover } from './CourseCover';
import { CourseRow } from './CourseRow';
import styles from './Catalog.module.css';

export type SortKey = 'popular' | 'rating' | 'price_asc' | 'price_desc';
const SORTS: SortKey[] = ['popular', 'rating', 'price_asc', 'price_desc'];

const sorters: Record<SortKey, (a: CourseSummary, b: CourseSummary) => number> = {
  popular: (a, b) => b.studentCount - a.studentCount,
  rating: (a, b) => b.rating - a.rating,
  price_asc: (a, b) => a.price.amount - b.price.amount,
  price_desc: (a, b) => b.price.amount - a.price.amount,
};

export interface CatalogState {
  q: string;
  category: string;
  sort: SortKey;
  view: 'grid' | 'list';
}

export function filterCourses(courses: CourseSummary[], s: Pick<CatalogState, 'q' | 'category' | 'sort'>) {
  const q = s.q.trim().toLowerCase();
  return courses
    .filter(
      (c) =>
        (!s.category || c.category?.slug === s.category) &&
        (!q || c.title.toLowerCase().includes(q) || (c.category?.name.toLowerCase().includes(q) ?? false)),
    )
    .sort(sorters[s.sort]);
}

/** Interactive catalogue. Filters, search, sort and view live in the URL, so they're shareable and survive reloads. */
export function CatalogBrowser({ catalog, membershipFrom }: { catalog: Catalog; membershipFrom: Money | null }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const sortParam = params.get('sort') as SortKey | null;
  const state: CatalogState = {
    q: params.get('q') ?? '',
    category: params.get('category') ?? '',
    sort: sortParam && SORTS.includes(sortParam) ? sortParam : 'popular',
    view: params.get('view') === 'list' ? 'list' : 'grid',
  };
  const set = (patch: Partial<CatalogState>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v || (k === 'sort' && v === 'popular') || (k === 'view' && v === 'grid')) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  return <CatalogView catalog={catalog} membershipFrom={membershipFrom} state={state} onChange={set} />;
}

/** Pure view — also rendered on the server (unfiltered) as the Suspense fallback, so crawlers get the full list. */
export function CatalogView({
  catalog,
  membershipFrom,
  state,
  onChange,
}: {
  catalog: Catalog;
  membershipFrom: Money | null;
  state: CatalogState;
  onChange?: (patch: Partial<CatalogState>) => void;
}) {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const f = useFormat();
  const searchId = useId();
  const deferredQ = useDeferredValue(state.q);
  const courses = filterCourses(catalog.courses, { ...state, q: deferredQ });
  const showSpotlight = !state.category && !deferredQ;
  const spotlight = showSpotlight ? catalog.courses.find((c) => c.featured) : undefined;
  const interactive = !!onChange;

  let results: ReactNode;
  if (courses.length === 0) results = <p className={styles.empty}>{t('empty')}</p>;
  else if (state.view === 'list')
    results = (
      <ul className={styles.list}>
        {courses.map((c) => (
          <li key={c.id}>
            <CourseRow course={c} />
          </li>
        ))}
      </ul>
    );
  else
    results = (
      <ul className={`grid-3 ${styles.grid}`}>
        {courses.map((c) => (
          <li key={c.id}>
            <CourseCard course={c} variant="catalog" headingLevel={2} />
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <div className={styles.controls} role="search">
        <label htmlFor={searchId} className="sr-only">
          {t('search')}
        </label>
        <div className={styles.searchWrap}>
          <Icon name="search" size={15} className={styles.searchIcon} />
          <input
            id={searchId}
            type="search"
            className={`input ${styles.search}`}
            placeholder={t('searchPlaceholder')}
            value={state.q}
            disabled={!interactive}
            onChange={(e) => onChange?.({ q: e.target.value })}
          />
        </div>
        <div className={styles.chips} role="group" aria-label={t('categories')}>
          <button
            type="button"
            className="chip"
            aria-pressed={!state.category}
            disabled={!interactive}
            onClick={() => onChange?.({ category: '' })}
          >
            {t('all')}
          </button>
          {catalog.categories.map((cat) => (
            <button
              key={cat.slug}
              type="button"
              className="chip"
              aria-pressed={state.category === cat.slug}
              disabled={!interactive}
              onClick={() => onChange?.({ category: cat.slug })}
            >
              {cat.name}
            </button>
          ))}
        </div>
        <div className={styles.right}>
          <label className="sr-only" htmlFor={`${searchId}-sort`}>
            {t('sortLabel')}
          </label>
          <select
            id={`${searchId}-sort`}
            className={`select ${styles.sort}`}
            value={state.sort}
            disabled={!interactive}
            onChange={(e) => onChange?.({ sort: e.target.value as SortKey })}
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sort.${s}`)}
              </option>
            ))}
          </select>
          <div className="segmented" role="group" aria-label={t('viewLabel')}>
            <button
              type="button"
              aria-pressed={state.view === 'grid'}
              aria-label={t('gridView')}
              disabled={!interactive}
              onClick={() => onChange?.({ view: 'grid' })}
            >
              <Icon name="grid" size={14} />
            </button>
            <button
              type="button"
              aria-pressed={state.view === 'list'}
              aria-label={t('listView')}
              disabled={!interactive}
              onClick={() => onChange?.({ view: 'list' })}
            >
              <Icon name="list" size={14} />
            </button>
          </div>
        </div>
      </div>

      <p className={styles.count} aria-live="polite">
        {tc('courses', { count: courses.length })}
      </p>

      {spotlight && (
        <div className={styles.spotlight}>
          <CourseCover cover={spotlight.cover} height={96} radius={12} className={styles.spotCover} sizes="170px" />
          <div className={styles.spotBody}>
            <p className="eyebrow eyebrow-brand">{t('mostPopular')}</p>
            <p className={styles.spotTitle}>{spotlight.title}</p>
            <p className={styles.spotMeta}>
              <span className="stars" aria-hidden="true">
                ★
              </span>{' '}
              {spotlight.rating.toFixed(1)} · {tc('students', { count: spotlight.studentCount })} ·{' '}
              {tc('lessons', { count: spotlight.lessonCount })} · {f.duration(spotlight.durationMinutes)}
            </p>
          </div>
          <Link href={routes.course(spotlight.slug)} className="btn btn-primary btn-lg">
            {t('viewCoursePrice', { price: f.coursePrice(spotlight.price, spotlight.pricing) })}
          </Link>
        </div>
      )}

      {results}

      {catalog.bundles.map((b) => (
        <section key={b.slug} className={styles.bundle} aria-labelledby={`bundle-${b.slug}`}>
          <div>
            <p className="eyebrow eyebrow-brand" style={{ fontSize: 10.5 }}>
              {t('bundle')}
            </p>
            <h2 id={`bundle-${b.slug}`} className={styles.bundleTitle}>
              {b.title}
            </h2>
            <p className={styles.bundleDesc}>{markdownToPlain(b.description)}</p>
          </div>
          <div className={styles.bundlePrice}>
            <p className={styles.compare}>
              <s>{f.money(b.compareAtPrice)}</s> · {t('save', { percent: b.savingsPercent })}
            </p>
            <p className="num" style={{ fontSize: 24 }}>
              {f.money(b.price)}
            </p>
          </div>
          <Link href={routes.checkoutBundle(b.slug)} className="btn btn-outline">
            {t('getBundle')}
          </Link>
        </section>
      ))}

      {membershipFrom && (
        <section className={styles.cta} aria-labelledby="catalog-membership">
          <div>
            <h2 id="catalog-membership" className={styles.ctaTitle}>
              {t('wantEverything')}
            </h2>
            <p className={styles.ctaBody}>{t('wantEverythingBody', { count: catalog.courses.length, price: f.money(membershipFrom) })}</p>
          </div>
          <Link href={routes.membership} className="btn btn-white">
            {t('seeMembership')}
          </Link>
        </section>
      )}
    </>
  );
}
