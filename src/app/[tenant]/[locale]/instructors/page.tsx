import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { JsonLd } from '@/components/seo/JsonLd';
import { InstructorGrid } from '@/features/instructors/components/InstructorGrid';
import styles from '@/features/instructors/components/Instructors.module.css';
import { getInstructors } from '@/features/instructors/server';
import { currentScope, getSite, localeBase, pageAlternates } from '@/features/tenant/server';
import { routes } from '@/lib/routes';
import { breadcrumbJsonLd, instructorListJsonLd, siteOpenGraph } from '@/lib/seo';
import { withSeo } from '@/features/seo/server';

export async function generateMetadata(): Promise<Metadata> {
  const { tenant, locale } = await currentScope();
  const [site, t, { alternates, url }] = await Promise.all([
    getSite(tenant, locale),
    getTranslations('instructors'),
    pageAlternates(routes.instructors),
  ]);
  const title = t('metaTitle');
  const description = t('metaDescription', { name: site.name });
  return withSeo(routes.instructors, {
    title,
    description,
    alternates,
    openGraph: { ...siteOpenGraph(site, locale), url, title, description },
  });
}

/**
 * The school's published instructor profiles, by name. Rendered on first visit, then cached until a profile or course
 * changes (`instructors` tag). Page 1 is server-rendered; further pages load with "Show more".
 */
export default async function InstructorsPage() {
  const { tenant, locale } = await currentScope();
  const [site, first, t, tn] = await Promise.all([
    getSite(tenant, locale),
    getInstructors(tenant, locale),
    getTranslations('instructors'),
    getTranslations('nav'),
  ]);
  const base = localeBase(site, locale);
  return (
    <div className="container page">
      <JsonLd
        data={[
          instructorListJsonLd(base, t('title'), first.data),
          breadcrumbJsonLd(base, [
            { name: tn('home'), path: routes.home },
            { name: t('title'), path: routes.instructors },
          ]),
        ]}
      />
      <h1 className="h1">{t('title')}</h1>
      <p className={`lead ${styles.intro}`}>{t('intro')}</p>
      <InstructorGrid first={first} />
    </div>
  );
}
