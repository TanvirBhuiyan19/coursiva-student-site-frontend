import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CertificateVerify } from '@/features/account/components/CertificateVerify';
import { getCertificateVerification } from '@/features/account/server';
import { currentScope, getSite, pageAlternates } from '@/features/tenant/server';
import { routes } from '@/lib/routes';
import { siteOpenGraph } from '@/lib/seo';

/** Rendered on first visit, then cached for a minute (the registry's own cache): revocations show up quickly. */
export function generateStaticParams() {
  return [];
}

/**
 * Shareable, but not indexed: it names a person. Open Graph tags give LinkedIn/Slack previews (crawlers that respect
 * `noindex` still read them; robots.txt deliberately doesn't block `/verify/`).
 */
export async function generateMetadata({ params }: PageProps<'/[tenant]/[locale]/verify/[code]'>): Promise<Metadata> {
  const { code } = await params;
  const { tenant, locale } = await currentScope();
  const [site, cert, t] = await Promise.all([getSite(tenant, locale), getCertificateVerification(tenant, code), getTranslations('verify')]);
  if (!cert) return { title: t('notFoundTitle'), robots: { index: false, follow: false } };
  const { alternates, url } = await pageAlternates(routes.verifyCertificate(cert.code));
  const title = t('metaTitle', { name: cert.holderName, course: cert.courseTitle });
  const description = t(`metaDescription.${cert.status}`, {
    name: cert.holderName,
    course: cert.courseTitle,
    issuer: cert.issuerName ?? site.name,
  });
  return {
    title,
    description,
    alternates,
    robots: { index: false, follow: false },
    openGraph: { ...siteOpenGraph(site, locale), url, title, description },
    twitter: { card: 'summary', title, description },
  };
}

export default async function VerifyCertificatePage({ params }: PageProps<'/[tenant]/[locale]/verify/[code]'>) {
  const { code } = await params;
  const { tenant, locale } = await currentScope();
  const [site, cert] = await Promise.all([getSite(tenant, locale), getCertificateVerification(tenant, code)]);
  if (!cert) notFound();
  return (
    <div className="container page" style={{ paddingTop: 64, paddingBottom: 90 }}>
      <CertificateVerify cert={cert} site={site} locale={locale} />
    </div>
  );
}
