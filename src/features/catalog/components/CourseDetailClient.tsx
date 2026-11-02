'use client';
import { Link, useLocalizedRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { useToast } from '@/components/toast/Toaster';
import { useSession } from '@/features/auth/api';
import { useAddToCart, useCart, useToggleWishlist, useWishlist } from '@/features/commerce/api';
import { useEnrollFree, useEnrollmentFor, useSubmitReview } from '@/features/learning/api';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { isCartable, isFreeCourse, pricingModel } from '../pricing';
import type { CourseDetail } from '../types';
import styles from './CourseDetail.module.css';
import { CourseCover } from './CourseCover';
import { CoursePreviewDialog, coverPreviewId, previewItems } from './CoursePreviewModal';

const PURCHASE_CARD_ID = 'purchase-card';

/**
 * The course's main call to action. Paid courses go to checkout (a subscription subscribes, pay what you want names
 * a price there); a course that comes with a membership links to the membership plans; free courses enrol in one
 * click (no checkout, no card): guests sign up first and come back to the course page.
 */
export function EnrollCta({ course, className, plan }: { course: CourseDetail; className: string; plan?: 'installments' }) {
  const t = useTranslations('course');
  const router = useLocalizedRouter();
  const toast = useToast();
  const { isSignedIn } = useSession();
  const enroll = useEnrollFree();
  if (pricingModel(course) === 'membership')
    return (
      <Link href={routes.membership} className={className}>
        {t('seeMembership')}
      </Link>
    );
  if (!isFreeCourse(course))
    return (
      <Link href={routes.checkoutCourse(course.slug, plan)} className={className}>
        {pricingModel(course) === 'subscription' ? t('subscribeNow') : t('enrollNow')}
      </Link>
    );
  if (!isSignedIn)
    return (
      <Link href={routes.signUp(routes.course(course.slug))} className={className}>
        {t('enrollFree')}
      </Link>
    );
  return (
    <button
      type="button"
      className={className}
      disabled={enroll.isPending}
      onClick={() =>
        enroll.mutate(course.slug, {
          onSuccess: (e) => {
            toast(t('enrolledFree', { title: course.title }));
            router.push(routes.player(course.slug, e.resumeLesson.id));
          },
          onError: (err) => toast(err instanceof ApiError ? err.message : t('enrollFailed')),
        })
      }
    >
      {t('enrollFree')}
    </button>
  );
}

/* ── Section nav ──────────────────────────────────────────────────────────── */

/**
 * Sticky in-page navigation. Plain anchor links (work without JS); a scroll-spy marks the section in view.
 */
export function SectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  const t = useTranslations('course');
  const [active, setActive] = useState(sections[0]?.id ?? '');
  const listRef = useRef<HTMLUListElement>(null);

  // On narrow screens the nav scrolls sideways: keep the current item in view (horizontal only, never the page).
  useEffect(() => {
    const list = listRef.current;
    const link = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !link) return;
    const left = link.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + link.offsetWidth > list.scrollLeft + list.clientWidth)
      list.scrollTo({ left: left - 16, behavior: 'smooth' });
  }, [active]);

  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
    let frame = 0;
    // Current = the last section whose top has passed the sticky header + nav (or the last one at page bottom).
    const update = () => {
      frame = 0;
      const line = (document.querySelector('header')?.getBoundingClientRect().height ?? 60) + 90;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      const current = atBottom ? els.at(-1) : els.filter((el) => el.getBoundingClientRect().top <= line).at(-1);
      setActive(current?.id ?? els[0]?.id ?? '');
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [sections]);

  return (
    <nav className={styles.sectionNav} aria-label={t('onThisPage')}>
      <ul ref={listRef}>
        {sections.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} aria-current={active === s.id ? 'true' : undefined} onClick={() => setActive(s.id)}>
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Opens or closes every module in the curriculum. */
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

/* ── Free preview ─────────────────────────────────────────────────────────── */

/**
 * Opens the free-preview modal (CoursePreviewModal): `media` renders the card's cover with a play overlay ("Preview
 * this course", the first free preview); `chip` is a curriculum row's "Preview" for `lessonId`. The modal's content
 * mounts only while it is open: opening fetches that lesson's signed URLs, closing (button, backdrop or Esc) unmounts
 * it, which stops playback and drops the URLs.
 */
export function PreviewButton({
  course,
  variant,
  lessonId = null,
}: {
  course: CourseDetail;
  variant: 'media' | 'chip';
  lessonId?: string | null;
}) {
  const t = useTranslations('course');
  const dialog = useRef<HTMLDialogElement>(null);
  const enrolled = useEnrollmentFor(course.slug);
  const [isOpen, setIsOpen] = useState(false);
  const open = () => {
    dialog.current?.showModal();
    setIsOpen(true);
  };

  return (
    <>
      {variant === 'chip' ? (
        <button type="button" className={styles.previewChip} onClick={open} aria-haspopup="dialog">
          <span className={styles.previewChipIcon} aria-hidden="true">
            <Icon name="play" size={8} fill="currentColor" />
          </span>
          <span className={styles.previewChipText}>{t('preview')}</span>
          {lessonId && <span className="sr-only"> {course.modules.flatMap((m) => m.lessons).find((l) => l.id === lessonId)?.title}</span>}
        </button>
      ) : (
        <button type="button" className={styles.mediaBtn} onClick={open} aria-haspopup="dialog" aria-label={t('previewThisCourse')}>
          <CourseCover cover={course.cover} height="100%" priority sizes="(max-width: 1023px) 100vw, 400px" />
          <span className={styles.mediaShade} aria-hidden="true" />
          <span className={styles.mediaPlay} aria-hidden="true">
            <Icon name="play" size={22} fill="currentColor" />
          </span>
          <span className={styles.mediaLabel} aria-hidden="true">
            {t('previewThisCourse')}
          </span>
        </button>
      )}
      <CoursePreviewDialog
        course={course}
        dialogRef={dialog}
        isOpen={isOpen}
        initialLessonId={lessonId ?? coverPreviewId(course)}
        onClose={() => setIsOpen(false)}
        footer={!enrolled && <EnrollCta course={course} className="btn btn-primary btn-sm" />}
        enrolCta={!enrolled && <EnrollCta course={course} className="btn btn-white btn-sm" />}
      />
    </>
  );
}

/* ── Purchase card ────────────────────────────────────────────────────────── */

/**
 * Preview media, price, payment choice, calls to action, guarantee and what's included. Server-renders the guest
 * state (the same for everyone, so the page caches); enrolled learners get progress and "Continue" after hydration.
 */
export function PurchaseCard({ course, includes }: { course: CourseDetail; includes: { icon: IconName; text: string }[] }) {
  const t = useTranslations('course');
  return (
    <div className={styles.card} id={PURCHASE_CARD_ID}>
      <div className={styles.media}>
        {previewItems(course).length > 0 ? (
          <PreviewButton course={course} variant="media" />
        ) : (
          <CourseCover cover={course.cover} height="100%" priority />
        )}
      </div>
      <div className={styles.cardBody}>
        <BuyBox course={course} />
        <div className={styles.includes}>
          <h2 className={styles.includesTitle}>{t('includes')}</h2>
          <ul>
            {includes.map((i) => (
              <li key={i.text}>
                <Icon name={i.icon} size={15} />
                {i.text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function BuyBox({ course }: { course: CourseDetail }) {
  const t = useTranslations('course');
  const f = useFormat();
  const router = useLocalizedRouter();
  const toast = useToast();
  const { isSignedIn } = useSession();
  const enrollment = useEnrollmentFor(course.slug);
  const { data: cart } = useCart();
  const { data: wishlist } = useWishlist();
  const addToCart = useAddToCart();
  const toggleWish = useToggleWishlist();
  const [plan, setPlan] = useState<'full' | 'installments'>('full');

  if (enrollment) {
    const done = enrollment.progress.percent === 100;
    return (
      <div className={styles.owned}>
        <p className={styles.ownedTitle}>{done ? t('ownedDone') : t('ownedInProgress')}</p>
        <div className={styles.progressRow}>
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={enrollment.progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('progress')}
          >
            <span style={{ width: `${enrollment.progress.percent}%` }} />
          </div>
          <span className={styles.pct}>{enrollment.progress.percent}%</span>
        </div>
        <p className={styles.ownedNext}>{t('upNextLesson', { title: enrollment.resumeLesson.title })}</p>
        <Link href={routes.player(course.slug, enrollment.resumeLesson.id)} className="btn btn-primary btn-block btn-lg">
          {done ? t('reviewCourse') : t('continueLearning')}
        </Link>
      </div>
    );
  }

  const inCart = !!cart?.items.some((i) => i.courseSlug === course.slug);
  const saved = !!wishlist?.some((w) => w.course.slug === course.slug);
  const pp = course.paymentPlan;
  const onPlan = plan === 'installments' && !!pp;
  // Free courses: one click to enrol; subscription, pay-what-you-want and membership courses sell from this page
  // only. Neither goes in a cart.
  const noCart = isFreeCourse(course) || !isCartable(course);
  const priceSub =
    pricingModel(course) === 'subscription'
      ? t('subscriptionSub')
      : pricingModel(course) === 'pay_what_you_want'
        ? t('pwywSub', { price: f.money(course.price) })
        : pricingModel(course) === 'membership'
          ? t('membershipSub')
          : t('onceSub');

  const share = async () => {
    const url = window.location.href.split('#')[0]!;
    if (typeof navigator.share === 'function') {
      await navigator.share({ title: course.title, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(url).then(
      () => toast(t('linkCopied')),
      () => toast(url),
    );
  };

  return (
    <>
      <div className={styles.priceRow}>
        <span className={styles.price}>{onPlan ? f.money(pp.installmentPrice) : f.coursePrice(course.price, course.pricing)}</span>
        <span className={styles.priceSub}>{onPlan ? t('perMonthFor', { count: pp.installments }) : priceSub}</span>
      </div>
      {pp && (
        <div className={styles.planToggle} role="group" aria-label={t('howToPay')}>
          <button type="button" aria-pressed={!onPlan} onClick={() => setPlan('full')}>
            {t('payInFull')}
          </button>
          <button type="button" aria-pressed={onPlan} onClick={() => setPlan('installments')}>
            {t('payments', { count: pp.installments })}
          </button>
        </div>
      )}
      <EnrollCta course={course} plan={onPlan ? 'installments' : undefined} className={`btn btn-primary btn-block btn-lg ${styles.cta}`} />
      {noCart ? null : inCart ? (
        <Link href={routes.cart} className={`btn btn-block btn-success ${styles.cta2}`}>
          {t('inCart')}
        </Link>
      ) : (
        <button
          type="button"
          className={`btn btn-outline btn-block ${styles.cta2}`}
          disabled={addToCart.isPending}
          onClick={() =>
            addToCart.mutate(course.slug, {
              onSuccess: () => toast(t('addedToCart', { title: course.title })),
              onError: (e) => toast(e instanceof ApiError ? e.message : t('cartFailed')),
            })
          }
        >
          {t('addToCart')}
        </button>
      )}
      <p className={styles.guarantee}>
        <Icon name="shield" size={14} />
        {t('guarantee', { days: course.guaranteeDays })}
      </p>
      <div className={styles.secondary}>
        <button
          type="button"
          className={styles.ghost}
          aria-pressed={saved}
          onClick={() => {
            if (!isSignedIn) {
              router.push(routes.signIn(routes.course(course.slug)));
              return;
            }
            toggleWish.mutate(
              { slug: course.slug, saved: !saved },
              { onSuccess: () => toast(saved ? t('removedFromWishlist') : t('savedToWishlist')) },
            );
          }}
        >
          <Icon name="heart" size={14} fill={saved ? 'currentColor' : 'none'} />
          {saved ? t('saved') : t('save')}
        </button>
        <button type="button" className={styles.ghost} onClick={() => void share()}>
          <Icon name="share" size={14} />
          {t('share')}
        </button>
      </div>
      {course.includedInPlan && (
        <Link href={routes.membership} className={styles.planLink}>
          <span>
            {t.rich('includedIn', {
              plan: course.includedInPlan.planName,
              b: (c) => <b>{c}</b>,
            })}
          </span>
          <span className={styles.planPrice}>{t('fromPerMonth', { price: f.money(course.includedInPlan.perMonth) })}</span>
        </Link>
      )}
    </>
  );
}

/**
 * Phone/tablet sticky purchase bar. Appears only once the inline purchase card has scrolled out of view, so the two
 * never compete on screen.
 */
export function MobileBuyBar({ course }: { course: CourseDetail }) {
  const t = useTranslations('course');
  const f = useFormat();
  const enrollment = useEnrollmentFor(course.slug);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const card = document.getElementById(PURCHASE_CARD_ID);
    if (!card) return;
    const observer = new IntersectionObserver(([e]) => setShow(!!e && !e.isIntersecting && e.boundingClientRect.top < 0));
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div className={styles.mobileBar} data-show={show} aria-hidden={!show} inert={!show}>
        <div className={styles.mobileText}>
          <p className={styles.mobileTitle}>{course.title}</p>
          {enrollment ? (
            <p className={styles.mobileSub}>{t('percentComplete', { percent: enrollment.progress.percent })}</p>
          ) : (
            <p className={styles.mobileSub}>
              <b>{f.coursePrice(course.price, course.pricing)}</b>
              {course.guaranteeDays > 0 && <> · {t('guarantee', { days: course.guaranteeDays })}</>}
            </p>
          )}
        </div>
        {enrollment ? (
          <Link href={routes.player(course.slug, enrollment.resumeLesson.id)} className="btn btn-primary">
            {enrollment.progress.percent === 100 ? t('reviewCourse') : t('continueLearning')}
          </Link>
        ) : (
          <EnrollCta course={course} className="btn btn-primary" />
        )}
      </div>
      <div className={styles.mobileSpace} aria-hidden="true" />
    </>
  );
}

/* ── Reviews ──────────────────────────────────────────────────────────────── */

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
      <p className="alert alert-ok" role="status" style={{ marginTop: 16 }}>
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
