import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { AuthForm } from '@/features/auth/components/AuthForms';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { getCurrentSite } from '@/features/tenant/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('signUpMeta'), robots: { index: false, follow: true } };
}

export default async function SignUpPage() {
  const site = await getCurrentSite();
  return (
    <AuthLayout site={site}>
      <Suspense>
        <AuthForm mode="signup" oauth={site.oauthProviders} />
      </Suspense>
    </AuthLayout>
  );
}
