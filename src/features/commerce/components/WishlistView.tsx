'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/toast/Toaster';
import { CourseCover } from '@/features/catalog/components/CourseCover';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { useAddToCart, useToggleWishlist, useWishlist } from '../api';
import styles from './Commerce.module.css';

export function WishlistView() {
  const t = useTranslations('wishlist');
  const tc = useTranslations('common');
  const f = useFormat();
  const toast = useToast();
  const router = useRouter();
  const { data, isPending } = useWishlist();
  const add = useAddToCart();
  const toggle = useToggleWishlist();
  const items = data ?? [];

  const moveToCart = async (slugs: string[]) => {
    for (const slug of slugs) {
      await add.mutateAsync(slug).catch(() => undefined);
      toggle.mutate({ slug, saved: false });
    }
    router.push(routes.cart);
  };

  if (isPending) return <div className="skeleton" style={{ height: 200, marginTop: 24 }} />;

  return (
    <>
      <div className={styles.pageHead}>
        <div>
          <h1 className="h1-sm">{t('title')}</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            {t('count', { count: items.length })}
          </p>
        </div>
        {items.length > 0 && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={add.isPending}
            onClick={() => void moveToCart(items.map((i) => i.course.slug))}
          >
            {t('addAll')}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{t('emptyTitle')}</p>
          <p>{t('emptyBody')}</p>
          <Link href={routes.courses} className="btn btn-primary" style={{ marginTop: 16 }}>
            {t('browse')}
          </Link>
        </div>
      ) : (
        <ul className={styles.items} style={{ marginTop: 24 }}>
          {items.map(({ course: c }) => (
            <li key={c.id} className={styles.item}>
              <CourseCover cover={c.cover} height={70} radius={10} className={styles.itemCover} sizes="110px" />
              <div className={styles.itemBody}>
                <Link href={routes.course(c.slug)} className={styles.itemTitle}>
                  {c.title}
                </Link>
                <p className={styles.itemMeta}>
                  <span className="stars" aria-hidden="true">
                    ★
                  </span>{' '}
                  {c.rating.toFixed(1)} · {tc('lessons', { count: c.lessonCount })} · {f.duration(c.durationMinutes)}
                </p>
              </div>
              <span className="num" style={{ fontSize: 18 }}>
                {f.money(c.price)}
              </span>
              <div className={styles.wishActions}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void moveToCart([c.slug])}>
                  {t('addToCart')}
                </button>
                <button
                  type="button"
                  className={styles.removeBtn}
                  onClick={() =>
                    toggle.mutate({ slug: c.slug, saved: false }, { onSuccess: () => toast(t('removed', { title: c.title })) })
                  }
                >
                  {tc('remove')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
