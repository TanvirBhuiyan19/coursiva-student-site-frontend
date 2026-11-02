import type { Metadata } from 'next';
import { JsonLd } from '@/components/seo/JsonLd';
import { BuilderPage, builderPageMetadata } from '@/features/pages/components/BuilderPage';
import { currentScope, getSite, localeBase, siteOrigin } from '@/features/tenant/server';
import { organizationJsonLd, websiteJsonLd } from '@/lib/seo';

/** The school's home page: the site builder's `/` page. */
export function generateMetadata(): Promise<Metadata> {
  return builderPageMetadata('home');
}

export default async function HomePage() {
  const { tenant, locale } = await currentScope();
  const site = await getSite(tenant, locale);
  return (
    <>
      <JsonLd
        data={[organizationJsonLd(site, siteOrigin(site)), websiteJsonLd(site, siteOrigin(site), localeBase(site, locale), locale)]}
      />
      <BuilderPage slug="home" />
    </>
  );
}
