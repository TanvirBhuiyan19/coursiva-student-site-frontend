'use client';
import { Link, useLocalizedRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { useToast } from '@/components/toast/Toaster';
import { useSession } from '@/features/auth/api';
import { CourseCover } from '@/features/catalog/components/CourseCover';
import { isCartable } from '@/features/catalog/pricing';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { useAddToCart, useCart, useQuote, useRemoveFromCart, useToggleWishlist } from '../api';
import styles from './Commerce.module.css';

export function CartView() {
  const t = useTranslations('cart');
  const tc = useTranslations('common');
  const f = useFormat();
  const toast = useToast();
  const router = useLocalizedRouter();
  const couponId = useId();
  const { isSignedIn } = useSession();
  const { data: cart, isPending, isError, refetch } = useCart();
  const remove = useRemoveFromCart();
  const add = useAddToCart();
  const wish = useToggleWishlist();
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<string | null>(null);
  const hasItems = !!cart?.items.length;
  const { data: quote } = useQuote(
    { target: { kind: 'cart' }, plan: 'full', couponCode: coupon, orderBump: false, seats: 1, country: '', giftCard: null },
    hasItems,
  );

  if (isPending) return <div className="skeleton" style={{ height: 240, marginTop: 24 }} />;
  if (isError)
    return (
      <div className="alert alert-bad" role="alert" style={{ marginTop: 24 }}>
        {tc('errorBody')}{' '}
        <button type="button" className="link-btn" onClick={() => void refetch()}>
          {tc('retry')}
        </button>
      </div>
    );

  return (
    <>
      {!hasItems ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{t('emptyTitle')}</p>
          <p>{t('emptyBody')}</p>
          <Link href={routes.courses} className="btn btn-primary" style={{ marginTop: 16 }}>
            {t('browse')}
          </Link>
        </div>
      ) : (
        <div className={styles.cartGrid}>
          <div>
            <ul className={styles.items}>
              {cart.items.map((item) => (
                <li key={item.courseId} className={styles.item}>
                  <CourseCover cover={item.cover} height={70} radius={10} className={styles.itemCover} sizes="110px" />
                  <div className={styles.itemBody}>
                    <Link href={routes.course(item.courseSlug)} className={styles.itemTitle}>
                      {item.title}
                    </Link>
                    <p className={styles.itemMeta}>
                      {t('itemMeta', { lessons: tc('lessons', { count: item.lessonCount }), duration: f.duration(item.durationMinutes) })}
                    </p>
                    <div className={styles.itemActions}>
                      <button
                        type="button"
                        className={styles.removeBtn}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(item.courseSlug, { onSuccess: () => toast(t('removed', { title: item.title })) })}
                      >
                        {tc('remove')}
                      </button>
                      {isSignedIn && (
                        <button
                          type="button"
                          className="link-btn"
                          style={{ fontSize: 12.5 }}
                          onClick={() =>
                            remove.mutate(item.courseSlug, {
                              onSuccess: () =>
                                wish.mutate(
                                  { slug: item.courseSlug, saved: true },
                                  { onSuccess: () => toast(t('movedToWishlist', { title: item.title })) },
                                ),
                            })
                          }
                        >
                          {t('moveToWishlist')}
                        </button>
                      )}
                    </div>
                  </div>
                  <span className="num" style={{ fontSize: 18 }}>
                    {f.money(item.price)}
                  </span>
                </li>
              ))}
            </ul>
            <Link href={routes.courses} className={styles.continue}>
              {t('continueShopping')}
            </Link>
          </div>
          <aside className={styles.summary} aria-labelledby="summary-title">
            <h2 id="summary-title" className={styles.summaryTitle}>
              {t('summary')}
            </h2>
            <form
              className={styles.coupon}
              onSubmit={(e) => {
                e.preventDefault();
                setCoupon(couponInput.trim() || null);
              }}
            >
              <label htmlFor={couponId} className="sr-only">
                {t('coupon')}
              </label>
              <input
                id={couponId}
                className="input"
                placeholder={t('coupon')}
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value)}
              />
              <button type="submit" className="btn btn-outline">
                {t('apply')}
              </button>
            </form>
            {quote?.coupon && (
              <p className={quote.coupon.valid ? styles.couponOk : styles.couponBad} role="status">
                {quote.coupon.message}
              </p>
            )}
            <dl className={styles.totals}>
              <div>
                <dt>{tc('courses', { count: cart.items.length })}</dt>
                <dd>{f.money(quote?.subtotal ?? cart.subtotal)}</dd>
              </div>
              {quote && quote.discount.amount > 0 && (
                <div className={styles.discount}>
                  <dt>{t('discount')}</dt>
                  <dd>−{f.money(quote.discount)}</dd>
                </div>
              )}
              <div className={styles.total}>
                <dt>{t('total')}</dt>
                <dd>{f.money(quote?.total ?? cart.subtotal)}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="btn btn-primary btn-block btn-lg"
              onClick={() => router.push(`${routes.checkoutCart}${coupon ? `&coupon=${encodeURIComponent(coupon)}` : ''}`)}
            >
              {t('checkout')}
            </button>
            <ul className={`ticks ${styles.trust}`}>
              <li>{t('trustGuarantee')}</li>
              <li>{t('trustLifetime')}</li>
              <li>{t('trustSecure')}</li>
            </ul>
          </aside>
        </div>
      )}

      {cart.recommendations.length > 0 && (
        <section aria-labelledby="recs-title" style={{ marginTop: 48 }}>
          <h2 id="recs-title" className="h2" style={{ fontSize: 22 }}>
            {t('alsoLike')}
          </h2>
          <ul className={`grid-3 ${styles.recs}`}>
            {cart.recommendations.map((c) => (
              <li key={c.id} className={styles.rec}>
                <CourseCover cover={c.cover} height={80} />
                <div className={styles.recBody}>
                  <Link href={routes.course(c.slug)} className={styles.recTitle}>
                    {c.title}
                  </Link>
                  <div className={styles.recRow}>
                    <span className="num">{f.coursePrice(c.price, c.pricing)}</span>
                    {isCartable(c) ? (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={add.isPending}
                        aria-label={t('addNamed', { title: c.title })}
                        onClick={() => add.mutate(c.slug, { onSuccess: () => toast(t('added', { title: c.title })) })}
                      >
                        {t('add')}
                      </button>
                    ) : (
                      // Subscription, pay-what-you-want and membership courses sell from their own page.
                      <Link href={routes.course(c.slug)} className="btn btn-outline btn-sm" aria-label={t('viewNamed', { title: c.title })}>
                        {t('view')}
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
