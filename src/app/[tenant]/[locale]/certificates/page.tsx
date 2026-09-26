import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Certificates } from '@/features/account/components/Certificates';
import { getCurrentSite } from '@/features/tenant/server';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('certificates');
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function CertificatesPage() {
  const [site, t] = await Promise.all([getCurrentSite(), getTranslations('certificates')]);
  if (!site.features.certificates) notFound();
  return (
    <div className="container page" style={{ maxWidth: 'calc(900px + 2 * var(--gutter))' }}>
      <Link href={routes.learning} style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--tx2)' }}>
        {t('back')}
      </Link>
      <h1 className="h1" style={{ marginTop: 10 }}>
        {t('title')}
      </h1>
      <Certificates site={{ name: site.name, logoUrl: site.logoUrl }} />
    </div>
  );
}
