import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ProfileView } from '@/features/account/components/ProfileView';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account');
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function AccountPage() {
  const t = await getTranslations('account');
  return (
    <div className="container page" style={{ maxWidth: 'calc(760px + 2 * var(--gutter))' }}>
      <h1 className="h1-sm">{t('title')}</h1>
      {/* The Discord card reads the link round trip's query string (useSearchParams). */}
      <Suspense fallback={<div className="skeleton" style={{ height: 520, marginTop: 24 }} />}>
        <ProfileView />
      </Suspense>
    </div>
  );
}
