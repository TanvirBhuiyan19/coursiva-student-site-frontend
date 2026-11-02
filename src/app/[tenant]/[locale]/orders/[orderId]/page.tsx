import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OrderDetail } from '@/features/commerce/components/OrderViews';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('order');
  return { title: t('detailMeta'), robots: { index: false, follow: false } };
}

/** The receipt email's link (`/orders/{id}`): the order's status, items, invoice and claim links. */
export default async function OrderPage({ params }: PageProps<'/[tenant]/[locale]/orders/[orderId]'>) {
  const { orderId } = await params;
  return (
    <div className="container page" style={{ paddingTop: 64, paddingBottom: 90 }}>
      <OrderDetail orderId={orderId} />
    </div>
  );
}
