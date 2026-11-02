import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { ProductView } from '@/features/commerce/components/ProductView';
import { getProduct } from '@/features/commerce/server';
import { currentScope, getSite, localeBase, pageAlternates } from '@/features/tenant/server';
import { markdownToPlain } from '@/lib/markdown';
import { routes } from '@/lib/routes';
import { breadcrumbJsonLd, metaDescription, productJsonLd, siteOpenGraph } from '@/lib/seo';
import { TrackView } from '@/features/tracking/TrackView';
import { withSeo } from '@/features/seo/server';

/** Rendered on first visit, then cached until the product changes (`t:<slug>:product:<product>`). */
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: PageProps<'/[tenant]/[locale]/products/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const { tenant, locale } = await currentScope();
  const [site, product, t] = await Promise.all([getSite(tenant, locale), getProduct(tenant, slug, locale), getTranslations('product')]);
  if (!product) return {};
  const { alternates, url } = await pageAlternates(routes.product(product.slug));
  const description = metaDescription(`${markdownToPlain(product.description)} ${t('metaSuffix', { name: site.name })}`);
  return withSeo(routes.product(product.slug), {
    title: product.title,
    description,
    alternates,
    openGraph: {
      ...siteOpenGraph(site, locale),
      url,
      title: product.title,
      description,
      // The dashboard-uploaded thumbnail is the share image when there is one.
      ...(product.thumbnailUrl ? { images: [{ url: product.thumbnailUrl, alt: product.title }] } : {}),
    },
  });
}

/**
 * A product's sales link (`/products/{slug}`, from the dashboard): a digital download or a course bundle with its
 * price and a buy button. Anything the storefront can't sell (draft, service, physical) is a 404.
 */
export default async function ProductPage({ params }: PageProps<'/[tenant]/[locale]/products/[slug]'>) {
  const { slug } = await params;
  const { tenant, locale } = await currentScope();
  const [site, product, tn] = await Promise.all([getSite(tenant, locale), getProduct(tenant, slug, locale), getTranslations('nav')]);
  if (!product) notFound();
  const base = localeBase(site, locale);
  return (
    <>
      <JsonLd
        data={[
          productJsonLd(site, base, product),
          breadcrumbJsonLd(base, [
            { name: tn('home'), path: routes.home },
            { name: product.title, path: routes.product(product.slug) },
          ]),
        ]}
      />
      <ProductView product={product} />
      <TrackView id={product.slug} name={product.title} price={product.price} />
    </>
  );
}
