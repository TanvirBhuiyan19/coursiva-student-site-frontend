import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { CourseDetailView } from '@/features/catalog/components/CourseDetailView';
import { getCourse } from '@/features/catalog/server';
import { currentTenant, getSite, siteOrigin } from '@/features/tenant/server';
import { routes } from '@/lib/routes';
import { breadcrumbJsonLd, courseJsonLd, faqJsonLd, metaDescription } from '@/lib/seo';

/** Course pages render on first visit and are then served from cache until the course changes (tag revalidation). */
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: PageProps<'/[tenant]/courses/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await currentTenant();
  const course = await getCourse(tenant, slug);
  if (!course) return {};
  const path = routes.course(course.slug);
  const description = metaDescription(course.excerpt);
  const image = course.cover.url ?? `${path}/og.png`;
  return {
    title: course.title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      url: path,
      title: course.title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: course.title }],
    },
    twitter: { card: 'summary_large_image', title: course.title, description, images: [image] },
  };
}

export default async function CoursePage({ params }: PageProps<'/[tenant]/courses/[slug]'>) {
  const { slug } = await params;
  const tenant = await currentTenant();
  const [site, course, tn, tc] = await Promise.all([
    getSite(tenant),
    getCourse(tenant, slug),
    getTranslations('nav'),
    getTranslations('catalog'),
  ]);
  if (!course) notFound();
  const origin = siteOrigin(site);
  return (
    <>
      <JsonLd
        data={[
          courseJsonLd(site, origin, course),
          breadcrumbJsonLd(origin, [
            { name: tn('home'), path: routes.home },
            { name: tc('title'), path: routes.courses },
            { name: course.title, path: routes.course(course.slug) },
          ]),
          ...(course.faqs.length ? [faqJsonLd(course.faqs)] : []),
        ]}
      />
      <CourseDetailView course={course} />
    </>
  );
}
