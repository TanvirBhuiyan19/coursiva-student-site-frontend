import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CartView } from '@/features/commerce/components/CartView';
import styles from '@/features/commerce/components/Commerce.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('cart');
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function CartPage() {
  const t = await getTranslations('cart');
  return (
    <div className={`container page ${styles.wrap}`}>
      <h1 className="h1-sm">{t('title')}</h1>
      <CartView />
    </div>
  );
}
