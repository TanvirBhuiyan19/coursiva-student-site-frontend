import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ClaimView } from '@/features/commerce/components/ClaimView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('claim');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** A gift or team-seat link (`/claim?token=`). Private: guests sign in (or sign up) first and come back here. */
export default function ClaimPage() {
  return (
    <div className="container page" style={{ paddingTop: 72, paddingBottom: 90 }}>
      <Suspense>
        <ClaimView />
      </Suspense>
    </div>
  );
}
