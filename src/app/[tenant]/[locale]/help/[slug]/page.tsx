import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { HelpArticleView } from '@/features/account/components/HelpArticleView';
import { getHelpArticle } from '@/features/account/server';
import { currentScope, getSite, localeBase, pageAlternates } from '@/features/tenant/server';
import { routes } from '@/lib/routes';
import { breadcrumbJsonLd, helpArticleJsonLd, metaDescription, siteOpenGraph } from '@/lib/seo';
import { withSeo } from '@/features/seo/server';

/** Help articles render on first visit and are then served from cache until the school edits its help centre. */
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: PageProps<'/[tenant]/[locale]/help/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const { tenant, locale } = await currentScope();
  const [site, article] = await Promise.all([getSite(tenant, locale), getHelpArticle(tenant, slug, locale)]);
  if (!article) return {};
  const { alternates, url } = await pageAlternates(routes.helpArticle(article.slug));
  const description = metaDescription(article.excerpt || article.title);
  return withSeo(routes.helpArticle(article.slug), {
    title: article.title,
    description,
    alternates,
    openGraph: { ...siteOpenGraph(site, locale), type: 'article', url, title: article.title, description, modifiedTime: article.updatedAt },
    twitter: { card: 'summary', title: article.title, description },
  });
}

export default async function HelpArticlePage({ params }: PageProps<'/[tenant]/[locale]/help/[slug]'>) {
  const { slug } = await params;
  const { tenant, locale } = await currentScope();
  const [site, article, tn, ts] = await Promise.all([
    getSite(tenant, locale),
    getHelpArticle(tenant, slug, locale),
    getTranslations('nav'),
    getTranslations('support'),
  ]);
  if (!article) notFound();
  const base = localeBase(site, locale);
  return (
    <>
      <JsonLd
        data={[
          helpArticleJsonLd(site, base, article),
          breadcrumbJsonLd(base, [
            { name: tn('home'), path: routes.home },
            { name: ts('helpMeta'), path: routes.help },
            { name: article.title, path: routes.helpArticle(article.slug) },
          ]),
        ]}
      />
      <HelpArticleView article={article} />
    </>
  );
}
