import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { VerifyEmailView } from '@/features/auth/components/AccountLinks';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('confirmEmailTitle'), robots: { index: false, follow: false } };
}

/** The emailed confirmation link (`?token=`); without a token, a signed-in learner can ask for a fresh link. */
export default function VerifyEmailPage() {
  return (
    <div className="container page" style={{ paddingTop: 72, paddingBottom: 90 }}>
      <Suspense>
        <VerifyEmailView />
      </Suspense>
    </div>
  );
}
