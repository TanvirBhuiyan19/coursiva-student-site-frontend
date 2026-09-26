import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { CommunityView } from '@/features/community/components/CommunityView';
import { getCurrentSite } from '@/features/tenant/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('community');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export default async function CommunityPage() {
  const site = await getCurrentSite();
  if (!site.features.community) notFound();
  return (
    <Suspense>
      <CommunityView site={{ name: site.name, logoUrl: site.logoUrl }} />
    </Suspense>
  );
}
