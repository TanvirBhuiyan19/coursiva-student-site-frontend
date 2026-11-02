import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OrdersView } from '@/features/commerce/components/OrdersView';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('orders');
  return { title: t('title'), robots: { index: false, follow: false } };
}

/** Order history: every order with its receipt and invoice (the receipt emails also link to each order). */
export default async function OrdersPage() {
  const [t, ta] = await Promise.all([getTranslations('orders'), getTranslations('account')]);
  return (
    <div className="container page" style={{ maxWidth: 'calc(760px + 2 * var(--gutter))' }}>
      <Link href={routes.account} className="muted" style={{ fontSize: 13.5 }}>
        {`← ${ta('title')}`}
      </Link>
      <h1 className="h1-sm" style={{ marginTop: 8 }}>
        {t('title')}
      </h1>
      <OrdersView />
    </div>
  );
}
