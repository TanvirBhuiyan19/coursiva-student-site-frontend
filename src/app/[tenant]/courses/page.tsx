import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { JsonLd } from '@/components/seo/JsonLd';
import { CatalogBrowser, CatalogView } from '@/features/catalog/components/CatalogBrowser';
import styles from '@/features/catalog/components/Catalog.module.css';
import { getCatalog } from '@/features/catalog/server';
import { getMembership } from '@/features/membership/server';
import { currentTenant, getSite, siteOrigin } from '@/features/tenant/server';
import { routes } from '@/lib/routes';
import { breadcrumbJsonLd, courseListJsonLd } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await currentTenant();
  const [site, t] = await Promise.all([getSite(tenant), getTranslations('catalog')]);
  const title = t('title');
  const description = t('metaDescription', { name: site.name });
  // Filters are client-side query params: the canonical URL is always the unfiltered catalogue.
  return { title, description, alternates: { canonical: routes.courses }, openGraph: { url: routes.courses, title, description } };
}

export default async function CoursesPage() {
  const tenant = await currentTenant();
  const [site, catalog, membership, t, tn] = await Promise.all([
    getSite(tenant),
    getCatalog(tenant),
    getMembership(tenant),
    getTranslations('catalog'),
    getTranslations('nav'),
  ]);
  const origin = siteOrigin(site);
  const popular = membership?.plans.find((p) => p.popular) ?? membership?.plans[0];
  const membershipFrom = popular?.prices.find((p) => p.interval === 'month')?.perMonth ?? null;
  const serverState = { q: '', category: '', sort: 'popular' as const, view: 'grid' as const };

  return (
    <>
      <JsonLd
        data={[
          courseListJsonLd(site, origin, catalog.courses),
          breadcrumbJsonLd(origin, [
            { name: tn('home'), path: routes.home },
            { name: t('title'), path: routes.courses },
          ]),
        ]}
      />
      <section className={styles.hero}>
        <div className="container">
          <h1 className="h1" style={{ fontSize: 40 }}>
            {t('title')}
          </h1>
          <p className="lead">{t('intro')}</p>
        </div>
      </section>
      <div className="container" style={{ paddingBottom: 80 }}>
        {/* The server renders the full, unfiltered list (what crawlers index); the browser swaps in the URL-driven view. */}
        <Suspense fallback={<CatalogView catalog={catalog} membershipFrom={membershipFrom} state={serverState} />}>
          <CatalogBrowser catalog={catalog} membershipFrom={membershipFrom} />
        </Suspense>
      </div>
    </>
  );
}
