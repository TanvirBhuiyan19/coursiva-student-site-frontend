import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Dashboard } from '@/features/learning/components/Dashboard';
import { getCurrentSite } from '@/features/tenant/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('learning');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Signed-in home. The page shell is static; learner data loads in the browser (the proxy has already gated guests). */
export default async function LearningPage() {
  const site = await getCurrentSite();
  return <Dashboard organizer={site.name} showCertificates={site.features.certificates} />;
}
