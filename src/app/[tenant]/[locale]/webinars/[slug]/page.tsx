import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { withSeo } from '@/features/seo/server';
import { currentScope, getSite, localeBase, pageAlternates } from '@/features/tenant/server';
import { WebinarView } from '@/features/webinars/components/WebinarView';
import { getWebinar } from '@/features/webinars/server';
import { routes } from '@/lib/routes';
import { breadcrumbJsonLd, metaDescription, siteOpenGraph, webinarJsonLd } from '@/lib/seo';

/** Rendered on first visit, then cached briefly (`t:<slug>:webinar:<webinar>`, 60 s); seats are re-read in the browser. */
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: PageProps<'/[tenant]/[locale]/webinars/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const { tenant, locale } = await currentScope();
  const [site, w, t] = await Promise.all([getSite(tenant, locale), getWebinar(tenant, slug, locale), getTranslations('webinars')]);
  if (!w) return {};
  const { alternates, url } = await pageAlternates(routes.webinar(w.slug));
  const description = metaDescription(w.description || t('metaFallback', { title: w.title, school: site.name }));
  return withSeo(routes.webinar(w.slug), {
    title: w.title,
    description,
    alternates,
    // An ended webinar stays reachable (links in old emails) but leaves search results.
    ...(w.status === 'ended' ? { robots: { index: false, follow: true } } : {}),
    openGraph: { ...siteOpenGraph(site, locale), url, title: w.title, description },
  });
}

/**
 * A public webinar (`/webinars/{slug}`, the dashboard's share link): anyone can read it and register with a name and
 * an email, or buy a ticket for a paid one. A session that isn't public is a 404.
 */
export default async function WebinarPage({ params }: PageProps<'/[tenant]/[locale]/webinars/[slug]'>) {
  const { slug } = await params;
  const { tenant, locale } = await currentScope();
  const [site, w, tn] = await Promise.all([getSite(tenant, locale), getWebinar(tenant, slug, locale), getTranslations('nav')]);
  if (!w) notFound();
  const base = localeBase(site, locale);
  return (
    <div className="container page" style={{ paddingTop: 48, paddingBottom: 90 }}>
      <JsonLd
        data={[
          webinarJsonLd(site, base, w),
          breadcrumbJsonLd(base, [
            { name: tn('home'), path: routes.home },
            { name: w.title, path: routes.webinar(w.slug) },
          ]),
        ]}
      />
      <WebinarView initial={w} />
    </div>
  );
}
