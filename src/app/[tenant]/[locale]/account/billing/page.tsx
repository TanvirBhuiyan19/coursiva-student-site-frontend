import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BillingView } from '@/features/account/components/BillingView';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account');
  return { title: t('billing'), robots: { index: false, follow: false } };
}

/** Billing (the dunning and payment-plan e-mails link here): card, membership and the billing portal. */
export default async function BillingPage() {
  const t = await getTranslations('account');
  return (
    <div className="container page" style={{ maxWidth: 'calc(760px + 2 * var(--gutter))' }}>
      <Link href={routes.account} className="muted" style={{ fontSize: 13.5 }}>
        {`← ${t('title')}`}
      </Link>
      <h1 className="h1-sm" style={{ marginTop: 8 }}>
        {t('billing')}
      </h1>
      <BillingView />
    </div>
  );
}
