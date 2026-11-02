import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { AuthForm } from '@/features/auth/components/AuthForms';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { getCurrentSite } from '@/features/tenant/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('joinMeta'), robots: { index: false, follow: false } };
}

/** A group's invite link (`/join/{token}`, the group's random invite secret): create an account that takes a seat in the group. */
export default async function JoinGroupPage({ params }: PageProps<'/[tenant]/[locale]/join/[group]'>) {
  const [{ group }, site, t] = await Promise.all([params, getCurrentSite(), getTranslations('auth')]);
  return (
    <AuthLayout site={site}>
      <p className="alert alert-ok" role="note" style={{ marginBottom: 16 }}>
        {t('joinInvite', { school: site.name })}
      </p>
      <Suspense>
        <AuthForm mode="signup" oauth={[]} screen={site.screens.auth} group={group} />
      </Suspense>
    </AuthLayout>
  );
}
