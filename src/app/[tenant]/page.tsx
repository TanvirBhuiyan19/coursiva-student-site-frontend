import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import { Sections } from '@/features/pages/components/Sections';
import { getPage } from '@/features/pages/server';
import { currentTenant, getSite, siteOrigin } from '@/features/tenant/server';
import { organizationJsonLd, websiteJsonLd } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await currentTenant();
  const [site, page] = await Promise.all([getSite(tenant), getPage(tenant, 'home')]);
  return {
    title: { absolute: page?.seo.title ?? site.seo.title },
    description: page?.seo.description ?? site.seo.description,
    alternates: { canonical: '/' },
    openGraph: { url: '/', title: page?.seo.title ?? site.seo.title, description: page?.seo.description ?? site.seo.description },
  };
}

export default async function HomePage() {
  const tenant = await currentTenant();
  const [site, page] = await Promise.all([getSite(tenant), getPage(tenant, 'home')]);
  if (!page) notFound();
  const origin = siteOrigin(site);
  return (
    <>
      <JsonLd data={[organizationJsonLd(site, origin), websiteJsonLd(site, origin)]} />
      <Sections sections={page.sections} />
    </>
  );
}
