import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Invoice } from '@/features/commerce/components/OrderViews';
import { getCurrentSite } from '@/features/tenant/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('order');
  return { title: t('invoiceMeta'), robots: { index: false, follow: false } };
}

export default async function InvoicePage({ params }: PageProps<'/[tenant]/[locale]/orders/[orderId]/invoice'>) {
  const [{ orderId }, site] = await Promise.all([params, getCurrentSite()]);
  return (
    <div className="container page" style={{ paddingTop: 44 }}>
      <Invoice orderId={orderId} site={{ name: site.name, logoUrl: site.logoUrl, primaryHost: site.primaryHost }} />
    </div>
  );
}
