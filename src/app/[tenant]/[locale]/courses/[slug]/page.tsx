import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { CourseDetailView } from '@/features/catalog/components/CourseDetailView';
import { getCourse } from '@/features/catalog/server';
import { TrackView } from '@/features/tracking/TrackView';
import { currentScope, getSite, localeBase, pageAlternates } from '@/features/tenant/server';
import { routes } from '@/lib/routes';
import { breadcrumbJsonLd, courseJsonLd, faqJsonLd, metaDescription, siteOpenGraph } from '@/lib/seo';
import { withSeo } from '@/features/seo/server';

/** Course pages render on first visit and are then served from cache until the course changes (tag revalidation). */
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: PageProps<'/[tenant]/[locale]/courses/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const { tenant, locale } = await currentScope();
  const [site, course] = await Promise.all([getSite(tenant, locale), getCourse(tenant, slug, locale)]);
  if (!course) return {};
  const { alternates, url: path } = await pageAlternates(routes.course(course.slug));
  const description = metaDescription(course.excerpt);
  const image = course.cover.url ?? `${path}/og.png`;
  return withSeo(routes.course(course.slug), {
    title: course.title,
    description,
    alternates,
    openGraph: {
      ...siteOpenGraph(site, locale),
      url: path,
      title: course.title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: course.title }],
    },
    twitter: { card: 'summary_large_image', title: course.title, description, images: [image] },
  });
}

export default async function CoursePage({ params }: PageProps<'/[tenant]/[locale]/courses/[slug]'>) {
  const { slug } = await params;
  const { tenant, locale } = await currentScope();
  const [site, course, tn, tc] = await Promise.all([
    getSite(tenant, locale),
    getCourse(tenant, slug, locale),
    getTranslations('nav'),
    getTranslations('catalog'),
  ]);
  if (!course) notFound();
  const base = localeBase(site, locale);
  return (
    <>
      <JsonLd
        data={[
          courseJsonLd(site, base, locale, course),
          breadcrumbJsonLd(base, [
            { name: tn('home'), path: routes.home },
            { name: tc('title'), path: routes.courses },
            { name: course.title, path: routes.course(course.slug) },
          ]),
          ...(course.faqs.length ? [faqJsonLd(course.faqs)] : []),
        ]}
      />
      <CourseDetailView course={course} />
      <TrackView id={course.slug} name={course.title} price={course.price} />
    </>
  );
}
