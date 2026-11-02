import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BlogList } from '@/features/blog/components/BlogViews';
import { getBlogPosts } from '@/features/blog/server';
import { currentScope, getSite, pageAlternates } from '@/features/tenant/server';
import { routes } from '@/lib/routes';
import { siteOpenGraph } from '@/lib/seo';
import { withSeo } from '@/features/seo/server';

export async function generateMetadata(): Promise<Metadata> {
  const { tenant, locale } = await currentScope();
  const [site, t, { alternates, url }] = await Promise.all([getSite(tenant, locale), getTranslations('blog'), pageAlternates(routes.blog)]);
  const title = t('metaTitle');
  const description = t('metaDescription', { name: site.name });
  return withSeo(routes.blog, { title, description, alternates, openGraph: { ...siteOpenGraph(site, locale), url, title, description } });
}

/** The school's blog: rendered on first visit, then cached until a post changes (`blog` tag) or 5 minutes pass. */
export default async function BlogPage() {
  const { tenant, locale } = await currentScope();
  const [posts, t] = await Promise.all([getBlogPosts(tenant), getTranslations('blog')]);
  return (
    <div className="container page">
      <h1 className="h1">{t('title')}</h1>
      <BlogList posts={posts} locale={locale} />
    </div>
  );
}
