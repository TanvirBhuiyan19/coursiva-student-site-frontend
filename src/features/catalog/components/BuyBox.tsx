'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Icon } from '@/components/icons';
import { useToast } from '@/components/toast/Toaster';
import { useSession } from '@/features/auth/api';
import { useAddToCart, useCart, useToggleWishlist, useWishlist } from '@/features/commerce/api';
import { useEnrollmentFor } from '@/features/learning/api';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import type { CourseDetail } from '../types';
import styles from './CourseDetail.module.css';

/**
 * The course page's purchase panel. Server-renders the guest state (identical for everyone, so the page caches);
 * once the session loads, enrolled learners see their progress and a Continue button instead.
 */
export function BuyBox({ course }: { course: CourseDetail }) {
  const t = useTranslations('course');
  const f = useFormat();
  const id = useId();
  const router = useRouter();
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
      <>
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
        <Link
          href={routes.player(course.slug, enrollment.resumeLesson.id)}
          className="btn btn-primary btn-block btn-lg"
          style={{ marginTop: 14 }}
        >
          {done ? t('reviewCourse') : t('continueLearning')}
        </Link>
      </>
    );
  }

  const inCart = !!cart?.items.some((i) => i.courseSlug === course.slug);
  const saved = !!wishlist?.some((w) => w.course.slug === course.slug);
  const pp = course.paymentPlan;

  return (
    <>
      <p className={styles.bigPrice}>
        <span className="num">
          {plan === 'installments' && pp ? `${f.money(pp.installmentPrice)}${t('perMonthShort')}` : f.money(course.price)}
        </span>
        <span className={styles.priceSub}>{plan === 'installments' && pp ? t('planSub', { count: pp.installments }) : t('onceSub')}</span>
      </p>
      {pp && (
        <fieldset className={styles.planPick}>
          <legend className="sr-only">{t('howToPay')}</legend>
          <label className="option">
            <input type="radio" name={`${id}-plan`} className="sr-only" checked={plan === 'full'} onChange={() => setPlan('full')} />
            <span className="radio-dot" aria-hidden="true" />
            <span className={styles.optLabel}>{t('oneTime')}</span>
            <span className={styles.optAmt}>{f.money(course.price)}</span>
          </label>
          <label className="option">
            <input
              type="radio"
              name={`${id}-plan`}
              className="sr-only"
              checked={plan === 'installments'}
              onChange={() => setPlan('installments')}
            />
            <span className="radio-dot" aria-hidden="true" />
            <span className={styles.optLabel}>{t('paymentPlan')}</span>
            <span className={styles.optAmt}>{t('planAmount', { count: pp.installments, amount: f.money(pp.installmentPrice) })}</span>
          </label>
        </fieldset>
      )}
      <Link
        href={routes.checkoutCourse(course.slug, plan === 'installments' ? 'installments' : undefined)}
        className="btn btn-primary btn-block btn-lg"
        style={{ marginTop: 14 }}
      >
        {t('enrollNow')}
      </Link>
      {inCart ? (
        <Link href={routes.cart} className={`btn btn-block btn-success ${styles.cartBtn}`}>
          {t('inCart')}
        </Link>
      ) : (
        <button
          type="button"
          className={`btn btn-outline btn-block ${styles.cartBtn}`}
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
      <p className={styles.guarantee}>{t('guarantee', { days: course.guaranteeDays })}</p>
      {course.includedInPlan && (
        <Link href={routes.membership} className={styles.planLink}>
          {t.rich('includedIn', {
            plan: course.includedInPlan.planName,
            price: f.money(course.includedInPlan.perMonth),
            b: (c) => <b>{c}</b>,
          })}
        </Link>
      )}
      <button
        type="button"
        className={styles.saveBtn}
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
        {saved ? t('saved') : t('saveForLater')}
      </button>
    </>
  );
}

/** Phone-only sticky purchase bar (the tab bar is hidden on course pages). */
export function MobileBuyBar({ course }: { course: CourseDetail }) {
  const t = useTranslations('course');
  const f = useFormat();
  const enrollment = useEnrollmentFor(course.slug);
  return (
    <>
      <div className={styles.mobileBar}>
        {enrollment ? (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 700 }}>{t('percentComplete', { percent: enrollment.progress.percent })}</p>
              <div className="progress" style={{ marginTop: 6 }} aria-hidden="true">
                <span style={{ width: `${enrollment.progress.percent}%` }} />
              </div>
            </div>
            <Link href={routes.player(course.slug, enrollment.resumeLesson.id)} className="btn btn-primary btn-lg">
              {enrollment.progress.percent === 100 ? t('reviewCourse') : t('continueLearning')}
            </Link>
          </>
        ) : (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="num" style={{ fontSize: 21, lineHeight: 1.1 }}>
                {f.money(course.price)}
              </p>
              <p className={styles.mobileSub}>{t('mobileSub', { days: course.guaranteeDays })}</p>
            </div>
            <Link href={routes.checkoutCourse(course.slug)} className="btn btn-primary btn-lg">
              {t('enrollNow')}
            </Link>
          </>
        )}
      </div>
      <div className={styles.mobileSpace} aria-hidden="true" />
    </>
  );
}
