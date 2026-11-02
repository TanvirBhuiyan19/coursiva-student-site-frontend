import type { Metadata } from 'next';
import type {
  Article,
  BlogPosting,
  BreadcrumbList,
  CollectionPage,
  Course,
  Event,
  FAQPage,
  ItemList,
  Organization,
  Product,
  ProfilePage,
  WebSite,
  WithContext,
} from 'schema-dts';
import type { HelpArticle } from '@/features/account/types';
import type { BlogPost } from '@/features/blog/types';
import type { CourseDetail, CourseSummary } from '@/features/catalog/types';
import type { ProductPage } from '@/features/commerce/types';
import type { InstructorDetail, InstructorSummary } from '@/features/instructors/types';
import type { PublicWebinar } from '@/features/webinars/types';
import type { Site } from '@/features/tenant/types';
import type { Money } from './api/types';
import { markdownToPlain } from './markdown';

/**
 * schema.org builders. Every URL is absolute on the tenant's canonical origin. Keep these truthful: only mark up
 * what the page visibly shows (Google's structured-data policy), and never invent ratings or prices.
 */

const price = (m: Money) => (m.amount / 100).toFixed(2);

type OpenGraph = NonNullable<Metadata['openGraph']>;
const ogLocale = (l: string) => l.replace('-', '_');

/**
 * The site-wide Open Graph fields. A page's `openGraph` replaces the layout's whole object (Next merges metadata
 * shallowly), so every page that sets its own title/url spreads this first — otherwise og:image, og:site_name and
 * og:locale silently disappear. `image` overrides the site's share image.
 */
export function siteOpenGraph(site: Site, locale: string, image?: string | null): OpenGraph {
  const url = image ?? site.seo.ogImageUrl;
  return {
    siteName: site.name,
    type: 'website',
    locale: ogLocale(locale),
    alternateLocale: site.locales.filter((l) => l !== locale).map(ogLocale),
    ...(url ? { images: [{ url, width: 1200, height: 630 }] } : {}),
  };
}

/**
 * Tab and home-screen icons. Favicon: the site builder's favicon, else the Branding icon, else the logo, else the
 * generated brand tile (`/icon.png`). Apple touch icon: the Branding icon, else the logo, else the tile. Only the
 * generated tile is known to be a PNG; an uploaded image's type is left to the browser.
 */
export function siteIcons(site: Pick<Site, 'faviconUrl' | 'iconUrl' | 'logoUrl'>): NonNullable<Metadata['icons']> {
  const icon = site.faviconUrl ?? site.iconUrl ?? site.logoUrl;
  return {
    icon: [icon ? { url: icon } : { url: '/icon.png', type: 'image/png' }],
    apple: site.iconUrl ?? site.logoUrl ?? '/icon.png',
  };
}

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

/** `base` is the site origin plus the locale prefix (`localeBase`), so URLs point at this language's pages. */
export function websiteJsonLd(site: Site, origin: string, base: string, locale: string): WithContext<WebSite> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${base}/#website`,
    name: site.name,
    url: base,
    inLanguage: locale,
    publisher: { '@id': `${origin}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${base}/courses?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    } as unknown as WebSite['potentialAction'],
  };
}

function courseNode(site: Site, base: string, locale: string, c: CourseSummary, detail?: CourseDetail): Course {
  const url = `${base}/courses/${c.slug}`;
  return {
    '@type': 'Course',
    '@id': `${url}#course`,
    name: c.title,
    // The description is Markdown (dashboard rich text): JSON-LD carries its plain text.
    description: detail?.description ? markdownToPlain(detail.description) : c.excerpt,
    url,
    inLanguage: detail?.language ?? locale,
    provider: { '@type': 'Organization', name: site.name, sameAs: base },
    ...(c.reviewCount > 0
      ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: c.rating, reviewCount: c.reviewCount, bestRating: 5 } }
      : {}),
    offers: {
      '@type': 'Offer',
      category: c.price.amount > 0 ? 'Paid' : 'Free',
      price: price(c.price),
      priceCurrency: c.price.currency,
      availability: 'https://schema.org/InStock',
      url,
    },
    hasCourseInstance: {
      '@type': 'CourseInstance',
      courseMode: 'Online',
      courseWorkload: `PT${Math.floor(c.durationMinutes / 60)}H${c.durationMinutes % 60}M`,
      instructor: {
        '@type': 'Person',
        name: c.instructor.name,
        ...(c.instructor.slug ? { url: `${base}/instructors/${c.instructor.slug}` } : {}),
      },
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

export const courseJsonLd = (site: Site, base: string, locale: string, c: CourseDetail): WithContext<Course> => ({
  '@context': 'https://schema.org',
  ...courseNode(site, base, locale, c, c),
});

export function courseListJsonLd(site: Site, base: string, locale: string, courses: CourseSummary[]): WithContext<ItemList> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: courses.map((c, i) => ({ '@type': 'ListItem', position: i + 1, item: courseNode(site, base, locale, c) })),
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

/** A product's sales page: the product and its offer, exactly as the page shows them. */
export function productJsonLd(site: Site, base: string, p: ProductPage): WithContext<Product> {
  const url = `${base}/products/${p.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#product`,
    name: p.title,
    ...(p.description ? { description: markdownToPlain(p.description) } : {}),
    ...(p.thumbnailUrl ? { image: p.thumbnailUrl } : {}),
    url,
    brand: { '@type': 'Organization', name: site.name },
    offers: { '@type': 'Offer', price: price(p.price), priceCurrency: p.price.currency, availability: 'https://schema.org/InStock', url },
  };
}

/**
 * A public webinar's page: an online `Event` with its real start and end, the school as organizer and the ticket
 * offer (free, or its price; members-only sessions sell nothing, so no offer).
 */
export function webinarJsonLd(site: Site, base: string, w: PublicWebinar): WithContext<Event> {
  const url = `${base}/webinars/${w.slug}`;
  const end = new Date(Date.parse(w.startsAt) + w.durationMin * 60_000).toISOString();
  const offer =
    w.access === 'members'
      ? {}
      : {
          offers: {
            '@type': 'Offer' as const,
            price: w.access === 'paid' && w.price ? price(w.price) : '0',
            ...(w.access === 'paid' && w.price ? { priceCurrency: w.price.currency } : {}),
            availability: w.soldOut ? ('https://schema.org/SoldOut' as const) : ('https://schema.org/InStock' as const),
            url,
          },
        };
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    '@id': `${url}#event`,
    name: w.title,
    ...(w.description ? { description: w.description } : {}),
    url,
    startDate: w.startsAt,
    endDate: end,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    location: { '@type': 'VirtualLocation', url },
    organizer: { '@type': 'Organization', name: site.name, url: base },
    ...offer,
  };
}

/**
 * An instructor's profile page: `ProfilePage` whose `mainEntity` is the `Person` it shows — photo, headline (as both
 * description and job title), the expertise tags and every external profile (`sameAs`: social links + website).
 */
export function instructorProfileJsonLd(base: string, p: InstructorDetail): WithContext<ProfilePage> {
  const url = `${base}/instructors/${p.slug}`;
  const sameAs = [...p.socialLinks.map((l) => l.url), ...(p.website ? [p.website] : [])];
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    '@id': `${url}#profile`,
    url,
    name: p.name,
    ...(p.updatedAt ? { dateModified: p.updatedAt } : {}),
    mainEntity: {
      '@type': 'Person',
      '@id': `${url}#person`,
      name: p.name,
      url,
      ...(p.headline ? { description: p.headline, jobTitle: p.headline } : {}),
      ...(p.avatarUrl ? { image: p.avatarUrl } : {}),
      ...(p.expertise.length ? { knowsAbout: p.expertise } : {}),
      ...(sameAs.length ? { sameAs } : {}),
    },
  };
}

/** `/instructors`: a collection page listing the profiles shown. */
export function instructorListJsonLd(base: string, name: string, instructors: InstructorSummary[]): WithContext<CollectionPage> {
  const url = `${base}/instructors`;
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${url}#page`,
    url,
    name,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: instructors.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${base}/instructors/${p.slug}`,
        name: p.name,
      })),
    },
  };
}

export function faqJsonLd(faqs: { question: string; answer: string }[]): WithContext<FAQPage> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
  };
}

/** A help-centre article (`/help/{slug}`): what the page shows — title, summary, section, last update, publisher. */
export function helpArticleJsonLd(site: Site, base: string, a: HelpArticle): WithContext<Article> {
  const url = `${base}/help/${a.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${url}#article`,
    headline: a.title,
    description: a.excerpt,
    articleSection: a.category,
    dateModified: a.updatedAt,
    url,
    mainEntityOfPage: url,
    publisher: { '@type': 'Organization', name: site.name },
  };
}

/** A blog post (`/blog/{slug}`): headline, summary, author, dates and publisher, as the page shows them. */
export function blogPostingJsonLd(site: Site, origin: string, base: string, p: BlogPost): WithContext<BlogPosting> {
  const url = `${base}/blog/${p.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    headline: p.seo.title || p.title,
    description: p.seo.description || p.excerpt,
    url,
    mainEntityOfPage: url,
    ...(p.publishedAt ? { datePublished: p.publishedAt } : {}),
    ...(p.categories.length ? { articleSection: p.categories } : {}),
    ...(p.readMinutes > 0 ? { timeRequired: `PT${p.readMinutes}M` } : {}),
    author: { '@type': 'Person', name: p.author.name },
    publisher: { '@type': 'Organization', '@id': `${origin}/#organization`, name: site.name, url: origin },
  };
}

/** Meta description: plain text, ≤160 chars, cut on a word boundary. */
export function metaDescription(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, clean.lastIndexOf(' ', max - 1))}…`;
}
