import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { withSeo } from '@/features/seo/server';
import { currentScope, getSite, pageAlternates } from '@/features/tenant/server';
import { siteOpenGraph } from '@/lib/seo';
import { getPage, type PageResult } from '../server';
import { GatedPage } from './GatedPage';
import { Sections } from './Sections';

/** `home` → `/`, `about/team` → `/about/team`. */
export const pagePath = (slug: string) => (slug === 'home' ? '/' : `/${slug}`);

/**
 * Metadata for a builder page: the page's SEO title/description (else the page title / the site's description),
 * canonical + hreflang, the full Open Graph set (share image from the page, else the site), and noindex for
 * members-only and password pages.
 */
export async function builderPageMetadata(slug: string): Promise<Metadata> {
  const { tenant, locale } = await currentScope();
  const [site, result, { alternates, url }] = await Promise.all([
    getSite(tenant, locale),
    getPage(tenant, slug, locale),
    pageAlternates(pagePath(slug)),
  ]);
  if (result.status === 'not_found') return {};
  if (result.status === 'gated') {
    const t = await getTranslations('pages');
    const title = result.title ?? (result.gate === 'page_password_required' ? t('gate.passwordTitle') : t('gate.membersTitle'));
    return { title, robots: { index: false, follow: false }, alternates };
  }
  const { page } = result;
  const home = slug === 'home';
  const title = page.seo.title ?? (home ? site.seo.title : page.title);
  const description = page.seo.description ?? site.seo.description;
  return withSeo(pagePath(slug), {
    title: home ? { absolute: title } : title,
    description,
    alternates,
    openGraph: { ...siteOpenGraph(site, locale, page.seo.ogImageUrl), url, title, description },
    ...(page.seo.noindex ? { robots: { index: false, follow: false } } : {}),
  });
}

/** A builder page: its sections, the gate for password / members-only pages, or a 404. */
export async function BuilderPage({ slug, result }: { slug: string; result?: PageResult }) {
  const { tenant, locale } = await currentScope();
  const r = result ?? (await getPage(tenant, slug, locale));
  if (r.status === 'not_found') notFound();
  if (r.status === 'gated') return <GatedPage slug={slug} gate={r.gate} title={r.title} />;
  return <Sections sections={r.page.sections} title={r.page.title} />;
}
