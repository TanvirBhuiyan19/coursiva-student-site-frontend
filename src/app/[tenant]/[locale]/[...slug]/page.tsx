import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { BuilderPage, builderPageMetadata } from '@/features/pages/components/BuilderPage';
import { isPageSlug } from '@/features/pages/server';
import { currentScope, getSite } from '@/features/tenant/server';
import { localizePath } from '@/i18n/locales';

/**
 * Every other site-builder page (`/about`, `/about/team`…). Built-in screens (`/courses`, `/checkout`, `/sign-in`…)
 * are their own routes and always win over this catch-all, so a builder page can never shadow them. Pages render on
 * first visit and are then served from cache until a publish revalidates `t:<tenant>:pages`.
 */
export function generateStaticParams() {
  return [];
}

/** The API slug for the URL segments, or null when the path can't be a builder page (no API call then). */
function slugOf(segments: string[]): string | null {
  let slug: string;
  try {
    slug = segments.map((s) => decodeURIComponent(s)).join('/');
  } catch {
    return null; // malformed escape
  }
  return isPageSlug(slug) ? slug : null;
}

export async function generateMetadata({ params }: PageProps<'/[tenant]/[locale]/[...slug]'>): Promise<Metadata> {
  const slug = slugOf((await params).slug);
  return slug && slug !== 'home' ? builderPageMetadata(slug) : {};
}

export default async function SiteBuilderPage({ params }: PageProps<'/[tenant]/[locale]/[...slug]'>) {
  const slug = slugOf((await params).slug);
  if (slug === 'home') {
    // `/home` is the home page: one URL per page.
    const { tenant, locale } = await currentScope();
    permanentRedirect(localizePath(await getSite(tenant, locale), locale, '/'));
  }
  if (!slug) notFound();
  return <BuilderPage slug={slug} />;
}
