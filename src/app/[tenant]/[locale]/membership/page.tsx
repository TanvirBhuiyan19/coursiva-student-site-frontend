import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { MembershipView } from '@/features/membership/components/MembershipView';
import { getMembership } from '@/features/membership/server';
import { currentScope, getSite, localeBase, pageAlternates } from '@/features/tenant/server';
import { routes } from '@/lib/routes';
import { breadcrumbJsonLd, faqJsonLd, metaDescription, siteOpenGraph } from '@/lib/seo';
import { withSeo } from '@/features/seo/server';

export async function generateMetadata(): Promise<Metadata> {
  const { tenant, locale } = await currentScope();
  const [site, m, t, { alternates, url }] = await Promise.all([
    getSite(tenant, locale),
    getMembership(tenant, locale),
    getTranslations('membership'),
    pageAlternates(routes.membership),
  ]);
  if (!m) return {};
  const title = t('metaTitle');
  const description = metaDescription(`${m.subtitle} ${t('metaSuffix', { name: site.name })}`);
  return withSeo(routes.membership, {
    title,
    description,
    alternates,
    openGraph: { ...siteOpenGraph(site, locale), url, title, description },
  });
}

export default async function MembershipPage() {
  const { tenant, locale } = await currentScope();
  const [site, membership, tn] = await Promise.all([getSite(tenant, locale), getMembership(tenant, locale), getTranslations('nav')]);
  if (!membership) notFound();
  const origin = localeBase(site, locale);
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
