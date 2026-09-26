import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { MembershipView } from '@/features/membership/components/MembershipView';
import { getMembership } from '@/features/membership/server';
import { currentTenant, getSite, siteOrigin } from '@/features/tenant/server';
import { routes } from '@/lib/routes';
import { breadcrumbJsonLd, faqJsonLd, metaDescription } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await currentTenant();
  const [site, m, t] = await Promise.all([getSite(tenant), getMembership(tenant), getTranslations('membership')]);
  if (!m) return {};
  const title = t('metaTitle');
  const description = metaDescription(`${m.subtitle} ${t('metaSuffix', { name: site.name })}`);
  return { title, description, alternates: { canonical: routes.membership }, openGraph: { url: routes.membership, title, description } };
}

export default async function MembershipPage() {
  const tenant = await currentTenant();
  const [site, membership, tn] = await Promise.all([getSite(tenant), getMembership(tenant), getTranslations('nav')]);
  if (!membership) notFound();
  const origin = siteOrigin(site);
  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd(origin, [
            { name: tn('home'), path: routes.home },
            { name: tn('membership'), path: routes.membership },
          ]),
          faqJsonLd(membership.faqs),
        ]}
      />
      <MembershipView membership={membership} currency={site.currency} />
    </>
  );
}
