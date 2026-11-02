import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ResetPasswordForm } from '@/features/auth/components/AccountLinks';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('newPasswordTitle'), robots: { index: false, follow: false } };
}

/** The emailed reset link — and an invited learner's "set your password" link (`&invited=1`). */
export default function ResetPasswordPage() {
  return (
    <div className="container page" style={{ paddingTop: 72, paddingBottom: 90 }}>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
