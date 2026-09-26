import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import { Sections } from '@/features/pages/components/Sections';
import { getPage } from '@/features/pages/server';
import { currentScope, getSite, localeBase, pageAlternates, siteOrigin } from '@/features/tenant/server';
import { routes } from '@/lib/routes';
import { organizationJsonLd, websiteJsonLd } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { tenant, locale } = await currentScope();
  const [site, page, { alternates, url }] = await Promise.all([
    getSite(tenant, locale),
    getPage(tenant, 'home', locale),
    pageAlternates(routes.home),
  ]);
  const title = page?.seo.title ?? site.seo.title;
  const description = page?.seo.description ?? site.seo.description;
  return { title: { absolute: title }, description, alternates, openGraph: { url, title, description } };
}

export default async function HomePage() {
  const { tenant, locale } = await currentScope();
  const [site, page] = await Promise.all([getSite(tenant, locale), getPage(tenant, 'home', locale)]);
  if (!page) notFound();
  return (
    <>
      <JsonLd
        data={[organizationJsonLd(site, siteOrigin(site)), websiteJsonLd(site, siteOrigin(site), localeBase(site, locale), locale)]}
      />
      <Sections sections={page.sections} />
    </>
  );
}
