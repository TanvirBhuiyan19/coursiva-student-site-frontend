import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WishlistView } from '@/features/commerce/components/WishlistView';
import styles from '@/features/commerce/components/Commerce.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('wishlist');
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default function WishlistPage() {
  return (
    <div className={`container page ${styles.wrap}`}>
      <WishlistView />
    </div>
  );
}
