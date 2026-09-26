'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { useToast } from '@/components/toast/Toaster';
import { useEnrollmentFor, useSubmitReview } from '@/features/learning/api';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import type { CourseDetail } from '../types';
import styles from './CourseDetail.module.css';

type Tab = 'overview' | 'curriculum' | 'reviews';
const TABS: Tab[] = ['overview', 'curriculum', 'reviews'];

/**
 * WAI-ARIA tabs (arrow keys move, Home/End jump). All panels are in the HTML; inactive ones are `hidden`.
 * `#curriculum` / `#reviews` in the URL open that tab, so links can deep-link.
 */
export function CourseTabs({
  labels,
  overview,
  curriculum,
  reviews,
}: {
  labels: Record<Tab, string>;
  overview: ReactNode;
  curriculum: ReactNode;
  reviews: ReactNode;
}) {
  const id = useId();
  const [tab, setTab] = useState<Tab>('overview');
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ overview: null, curriculum: null, reviews: null });

  useEffect(() => {
    const fromHash = window.location.hash.slice(1) as Tab;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from the URL hash (unknown during SSR)
    if (TABS.includes(fromHash)) setTab(fromHash);
  }, []);

  const select = (next: Tab, focus = false) => {
    setTab(next);
    history.replaceState(null, '', next === 'overview' ? window.location.pathname + window.location.search : `#${next}`);
    if (focus) refs.current[next]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const map: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 };
    if (!(e.key in map)) return;
    e.preventDefault();
    select(TABS[(map[e.key]! + TABS.length) % TABS.length]!, true);
  };
  const panels: Record<Tab, ReactNode> = { overview, curriculum, reviews };

  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label={labels.overview}>
        {TABS.map((t) => (
          <button
            key={t}
            ref={(el) => {
              refs.current[t] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-${t}`}
            aria-selected={tab === t}
            aria-controls={`${id}-${t}-panel`}
            tabIndex={tab === t ? 0 : -1}
            className={styles.tab}
            onClick={() => select(t)}
            onKeyDown={onKey}
          >
            {labels[t]}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <div
          key={t}
          role="tabpanel"
          id={`${id}-${t}-panel`}
          aria-labelledby={`${id}-${t}`}
          hidden={tab !== t}
          className={styles.panel}
          tabIndex={0}
        >
          {panels[t]}
        </div>
      ))}
    </>
  );
}

/** Opens or closes every module <details> in the curriculum. */
export function ExpandAll({ targetId }: { targetId: string }) {
  const t = useTranslations('course');
  const [allOpen, setAllOpen] = useState(false);
  return (
    <button
      type="button"
      className="link-btn"
      style={{ fontSize: 13.5 }}
      onClick={() => {
        const next = !allOpen;
        document.querySelectorAll<HTMLDetailsElement>(`#${targetId} > details`).forEach((d) => (d.open = next));
        setAllOpen(next);
      }}
    >
      {allOpen ? t('collapseAll') : t('expandAll')}
    </button>
  );
}

/** "Preview" chip on the free lesson, opening a modal player. */
export function PreviewButton({ course }: { course: CourseDetail }) {
  const t = useTranslations('course');
  const dialog = useRef<HTMLDialogElement>(null);
  const enrolled = useEnrollmentFor(course.slug);
  return (
    <>
      <button type="button" className={styles.previewBtn} onClick={() => dialog.current?.showModal()}>
        {t('preview')}
      </button>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- backdrop click; <dialog> handles Esc natively */}
      <dialog
        ref={dialog}
        className={styles.previewDialog}
        aria-labelledby="preview-title"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
      >
        <div className={styles.previewHead}>
          <h2 id="preview-title" className={styles.previewTitle}>
            {t('previewTitle', { title: course.preview?.title ?? '' })}
          </h2>
          <button type="button" className={styles.previewClose} onClick={() => dialog.current?.close()} aria-label={t('closePreview')}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className={styles.previewVideo}>
          <span className={styles.previewPlay} aria-hidden="true">
            ▶
          </span>
        </div>
        <div className={styles.previewFoot}>
          <span>{t('previewCta', { count: course.lessonCount })}</span>
          {!enrolled && (
            <Link href={routes.checkoutCourse(course.slug)} className="btn btn-primary btn-sm">
              {t('enrollNow')}
            </Link>
          )}
        </div>
      </dialog>
    </>
  );
}

/** Enrolled learners who haven't reviewed yet can post one. The API enforces the same rules. */
export function WriteReview({ courseSlug }: { courseSlug: string }) {
  const t = useTranslations('course');
  const toast = useToast();
  const id = useId();
  const enrolled = useEnrollmentFor(courseSlug);
  const submit = useSubmitReview(courseSlug);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!enrolled) return null;
  if (submit.isSuccess) {
    return (
      <p className="alert alert-ok" role="status" style={{ marginTop: 14 }}>
        {t('reviewThanks')}
      </p>
    );
  }
  if (submit.error instanceof ApiError && submit.error.fieldErrors.body?.includes('already')) return null;

  return (
    <form
      className={styles.writeReview}
      onSubmit={(e) => {
        e.preventDefault();
        if (!rating || body.trim().length < 10) {
          setError(t('reviewInvalid'));
          return;
        }
        submit.mutate(
          { rating, body: body.trim() },
          {
            onSuccess: () => toast(t('reviewPosted')),
            onError: (err) => setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : t('reviewFailed')),
          },
        );
      }}
    >
      <p className={styles.writeTitle}>{t('writeReview')}</p>
      <fieldset className={styles.starPicker}>
        <legend className="sr-only">{t('yourRating')}</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} data-on={n <= rating}>
            <input
              type="radio"
              name={`${id}-rating`}
              value={n}
              checked={rating === n}
              onChange={() => {
                setRating(n);
                setError(null);
              }}
              className="sr-only"
            />
            <span aria-hidden="true">★</span>
            <span className="sr-only">{t('starsShort', { count: n })}</span>
          </label>
        ))}
      </fieldset>
      <label htmlFor={`${id}-body`} className="sr-only">
        {t('reviewLabel')}
      </label>
      <textarea
        id={`${id}-body`}
        className="textarea"
        rows={3}
        placeholder={t('reviewPlaceholder')}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setError(null);
        }}
        aria-invalid={!!error}
      />
      {error && <p className="field-error">{error}</p>}
      <button type="submit" className="btn btn-primary btn-sm" disabled={submit.isPending} style={{ alignSelf: 'flex-start' }}>
        {t('postReview')}
      </button>
    </form>
  );
}
