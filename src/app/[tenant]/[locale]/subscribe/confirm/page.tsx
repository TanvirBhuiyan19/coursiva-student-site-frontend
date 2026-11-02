import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ConfirmSubscriptionView } from '@/features/auth/components/AccountLinks';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('confirmSubscriptionTitle'), robots: { index: false, follow: false } };
}

/** The double opt-in link (`?token=`) in a school's "Confirm your subscription" email. */
export default function ConfirmSubscriptionPage() {
  return (
    <div className="container page" style={{ paddingTop: 72, paddingBottom: 90 }}>
      <Suspense>
        <ConfirmSubscriptionView />
      </Suspense>
    </div>
  );
}
