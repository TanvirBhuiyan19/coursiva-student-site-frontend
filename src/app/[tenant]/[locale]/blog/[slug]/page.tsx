import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BlogPostView } from '@/features/blog/components/BlogViews';
import { getBlogPost } from '@/features/blog/server';
import { getTranslations } from 'next-intl/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { currentScope, getSite, localeBase, pageAlternates, siteOrigin } from '@/features/tenant/server';
import { routes } from '@/lib/routes';
import { blogPostingJsonLd, breadcrumbJsonLd, metaDescription, siteOpenGraph } from '@/lib/seo';
import { withSeo } from '@/features/seo/server';

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: PageProps<'/[tenant]/[locale]/blog/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const { tenant, locale } = await currentScope();
  const [site, post] = await Promise.all([getSite(tenant, locale), getBlogPost(tenant, slug)]);
  if (!post) return {};
  const { alternates, url } = await pageAlternates(routes.blogPost(post.slug));
  const description = metaDescription(post.seo.description || post.excerpt);
  return withSeo(routes.blogPost(post.slug), {
    title: post.seo.title,
    description,
    alternates,
    openGraph: {
      ...siteOpenGraph(site, locale),
      type: 'article',
      url,
      title: post.seo.title,
      description,
      ...(post.publishedAt ? { publishedTime: post.publishedAt } : {}),
    },
    twitter: { card: 'summary', title: post.seo.title, description },
  });
}

export default async function BlogPostPage({ params }: PageProps<'/[tenant]/[locale]/blog/[slug]'>) {
  const { slug } = await params;
  const { tenant, locale } = await currentScope();
  const [site, post, tn, tb] = await Promise.all([
    getSite(tenant, locale),
    getBlogPost(tenant, slug),
    getTranslations('nav'),
    getTranslations('blog'),
  ]);
  if (!post) notFound();
  const base = localeBase(site, locale);
  return (
    <div className="container page">
      <JsonLd
        data={[
          blogPostingJsonLd(site, siteOrigin(site), base, post),
          breadcrumbJsonLd(base, [
            { name: tn('home'), path: routes.home },
            { name: tb('title'), path: routes.blog },
            { name: post.title, path: routes.blogPost(post.slug) },
          ]),
        ]}
      />
      <BlogPostView post={post} locale={locale} />
    </div>
  );
}
