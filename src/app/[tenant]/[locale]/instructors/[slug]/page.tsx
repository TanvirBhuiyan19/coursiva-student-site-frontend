import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { InstructorProfileView } from '@/features/instructors/components/InstructorProfileView';
import { getInstructor, resolveInstructorRedirect } from '@/features/instructors/server';
import { currentScope, getSite, localeBase, pageAlternates } from '@/features/tenant/server';
import { localizePath } from '@/i18n/locales';
import { routes } from '@/lib/routes';
import { breadcrumbJsonLd, instructorProfileJsonLd, metaDescription, siteOpenGraph } from '@/lib/seo';
import { withSeo } from '@/features/seo/server';

/** Profiles render on first visit and are then served from cache until the profile or a course changes (tags). */
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: PageProps<'/[tenant]/[locale]/instructors/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const { tenant, locale } = await currentScope();
  const [site, p] = await Promise.all([getSite(tenant, locale), getInstructor(tenant, slug, locale)]);
  if (!p) return {};
  const { alternates, url } = await pageAlternates(routes.instructor(p.slug));
  const title = p.seo.title || p.name;
  const description = metaDescription(p.seo.description || p.headline);
  const image = p.seo.imageUrl;
  return withSeo(routes.instructor(p.slug), {
    title,
    description,
    alternates,
    openGraph: {
      ...siteOpenGraph(site, locale),
      type: 'profile',
      url,
      title,
      description,
      // The cover or the photo (its size is the school's upload); without either, the site's share image stays.
      ...(image ? { images: [{ url: image, alt: p.name }] } : {}),
    },
    twitter: { card: p.coverUrl ? 'summary_large_image' : 'summary', title, description, ...(image ? { images: [image] } : {}) },
  });
}

export default async function InstructorPage({ params }: PageProps<'/[tenant]/[locale]/instructors/[slug]'>) {
  const { slug } = await params;
  const { tenant, locale } = await currentScope();
  const [site, p, t, tn] = await Promise.all([
    getSite(tenant, locale),
    getInstructor(tenant, slug, locale),
    getTranslations('instructors'),
    getTranslations('nav'),
  ]);
  if (!p) {
    // A renamed profile's former address (or an SEO redirect the school made): follow it permanently.
    const to = await resolveInstructorRedirect(tenant, slug);
    if (to) permanentRedirect(localizePath(site, locale, to));
    notFound();
  }
  const base = localeBase(site, locale);
  return (
    <div className="container">
      <JsonLd
        data={[
          instructorProfileJsonLd(base, p),
          breadcrumbJsonLd(base, [
            { name: tn('home'), path: routes.home },
            { name: t('title'), path: routes.instructors },
            { name: p.name, path: routes.instructor(p.slug) },
          ]),
        ]}
      />
      <InstructorProfileView instructor={p} />
    </div>
  );
}
