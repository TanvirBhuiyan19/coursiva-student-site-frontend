import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OrderSuccess } from '@/features/commerce/components/OrderViews';
import { getCurrentSite } from '@/features/tenant/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('order');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** `?booking=slot|package` after a service's checkout (the page links to the learner's bookings). */
export default async function OrderSuccessPage({ params, searchParams }: PageProps<'/[tenant]/[locale]/checkout/success/[orderId]'>) {
  const [{ orderId }, site, sp] = await Promise.all([params, getCurrentSite(), searchParams]);
  const booking = sp.booking === 'slot' || sp.booking === 'package' ? sp.booking : null;
  return (
    <div className="container page" style={{ paddingTop: 64, paddingBottom: 90 }}>
      <OrderSuccess orderId={orderId} community={site.features.community} booking={booking} />
    </div>
  );
}
