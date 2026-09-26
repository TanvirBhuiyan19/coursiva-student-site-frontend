import type { BreadcrumbList, Course, FAQPage, ItemList, Organization, WebSite, WithContext } from 'schema-dts';
import type { CourseDetail, CourseSummary } from '@/features/catalog/types';
import type { Site } from '@/features/tenant/types';
import type { Money } from './api/types';

/**
 * schema.org builders. Every URL is absolute on the tenant's canonical origin. Keep these truthful: only mark up
 * what the page visibly shows (Google's structured-data policy), and never invent ratings or prices.
 */

const price = (m: Money) => (m.amount / 100).toFixed(2);

export function organizationJsonLd(site: Site, origin: string): WithContext<Organization> {
  return {
    '@context': 'https://schema.org',
    '@type': 'EducationalOrganization',
    '@id': `${origin}/#organization`,
    name: site.name,
    legalName: site.legalName,
    url: origin,
    description: site.seo.description,
    ...(site.logoUrl ? { logo: site.logoUrl } : {}),
    email: site.supportEmail,
    sameAs: site.social.map((s) => s.url),
  };
}

export function websiteJsonLd(site: Site, origin: string): WithContext<WebSite> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${origin}/#website`,
    name: site.name,
    url: origin,
    inLanguage: site.locale,
    publisher: { '@id': `${origin}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${origin}/courses?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    } as unknown as WebSite['potentialAction'],
  };
}

function courseNode(site: Site, origin: string, c: CourseSummary, detail?: CourseDetail): Course {
  const url = `${origin}/courses/${c.slug}`;
  return {
    '@type': 'Course',
    '@id': `${url}#course`,
    name: c.title,
    description: detail?.description ?? c.excerpt,
    url,
    inLanguage: detail?.language ?? site.locale,
    provider: { '@type': 'Organization', name: site.name, sameAs: origin },
    ...(c.reviewCount > 0
      ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: c.rating, reviewCount: c.reviewCount, bestRating: 5 } }
      : {}),
    offers: {
      '@type': 'Offer',
      category: 'Paid',
      price: price(c.price),
      priceCurrency: c.price.currency,
      availability: 'https://schema.org/InStock',
      url,
    },
    hasCourseInstance: {
      '@type': 'CourseInstance',
      courseMode: 'Online',
      courseWorkload: `PT${Math.floor(c.durationMinutes / 60)}H${c.durationMinutes % 60}M`,
      instructor: { '@type': 'Person', name: c.instructor.name },
    },
    educationalLevel: c.level === 'all_levels' ? 'All levels' : c.level,
    ...(detail
      ? {
          teaches: detail.outcomes,
          dateModified: detail.updatedAt,
          datePublished: detail.publishedAt,
          review: detail.reviews.slice(0, 5).map((r) => ({
            '@type': 'Review' as const,
            author: { '@type': 'Person' as const, name: r.author.name },
            datePublished: r.createdAt,
            reviewBody: r.body,
            reviewRating: { '@type': 'Rating' as const, ratingValue: r.rating, bestRating: 5 },
          })),
        }
      : {}),
  };
}

export const courseJsonLd = (site: Site, origin: string, c: CourseDetail): WithContext<Course> => ({
  '@context': 'https://schema.org',
  ...courseNode(site, origin, c, c),
});

export function courseListJsonLd(site: Site, origin: string, courses: CourseSummary[]): WithContext<ItemList> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: courses.map((c, i) => ({ '@type': 'ListItem', position: i + 1, item: courseNode(site, origin, c) })),
  };
}

export function breadcrumbJsonLd(origin: string, trail: { name: string; path: string }[]): WithContext<BreadcrumbList> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((b, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: b.name,
      item: `${origin}${b.path === '/' ? '' : b.path}`,
    })),
  };
}

export function faqJsonLd(faqs: { question: string; answer: string }[]): WithContext<FAQPage> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
  };
}

/** Meta description: plain text, ≤160 chars, cut on a word boundary. */
export function metaDescription(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, clean.lastIndexOf(' ', max - 1))}…`;
}
