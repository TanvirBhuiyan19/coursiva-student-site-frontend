import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ForgotPasswordForm } from '@/features/auth/components/AuthForms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('resetTitle'), robots: { index: false, follow: true } };
}

export default function ForgotPasswordPage() {
  return (
    <div className="container page" style={{ paddingTop: 72, paddingBottom: 90 }}>
      <ForgotPasswordForm />
    </div>
  );
}
