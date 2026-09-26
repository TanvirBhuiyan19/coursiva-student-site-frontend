import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OrderSuccess } from '@/features/commerce/components/OrderViews';
import { getCurrentSite } from '@/features/tenant/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('order');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export default async function OrderSuccessPage({ params }: PageProps<'/[tenant]/[locale]/checkout/success/[orderId]'>) {
  const [{ orderId }, site] = await Promise.all([params, getCurrentSite()]);
  return (
    <div className="container page" style={{ paddingTop: 64, paddingBottom: 90 }}>
      <OrderSuccess orderId={orderId} community={site.features.community} />
    </div>
  );
}
