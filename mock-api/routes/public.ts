/** Public, cacheable reads (the storefront) plus the two anonymous writes (newsletter, support ticket). */
import { Hono } from 'hono';
import type { Page, Section } from '@/features/pages/types';
import type { Catalog } from '@/features/catalog/types';
import type { Membership } from '@/features/membership/types';
import type { HelpCategory, LegalDocument, SupportTicketInput } from '@/features/account/types';
import type { AppContext, Env } from '../lib/db';
import { body, id, invalid, isEmail, notFound, ok, str } from '../lib/http';
import { courseDetail, courseSummary, membershipPlans, money, person } from '../lib/present';
import type { TenantData } from '../lib/records';

export const publicRoutes = new Hono<Env>();

const avgRating = (t: TenantData) =>
  (Math.round((t.courses.reduce((a, c) => a + c.rating, 0) / Math.max(1, t.courses.length)) * 10) / 10).toFixed(1);
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

publicRoutes.get('/site', (c: AppContext) => ok(c, c.get('t').site));

function categories(t: TenantData) {
  return t.categories.map((cat) => ({ ...cat, courseCount: t.courses.filter((x) => x.categorySlug === cat.slug).length }));
}

publicRoutes.get('/courses', (c: AppContext) => {
  const t = c.get('t');
  const catalog: Catalog = {
    courses: [...t.courses].sort((a, b) => b.studentCount - a.studentCount).map((x) => courseSummary(t, x)),
    categories: categories(t),
    bundles: t.bundles.map((b) => {
      const compare = b.courseSlugs.reduce((a, s) => a + (t.courses.find((x) => x.slug === s)?.price ?? 0), 0);
      return {
        ...b,
        price: money(t, b.price),
        compareAtPrice: money(t, compare),
        savingsPercent: Math.round(((compare - b.price) / compare) * 100),
      };
    }),
  };
  return ok(c, catalog);
});

publicRoutes.get('/courses/:slug', (c: AppContext) => {
  const t = c.get('t');
  const row = t.courses.find((x) => x.slug === c.req.param('slug'));
  return row ? ok(c, courseDetail(t, row)) : notFound(c, 'Course');
});

publicRoutes.get('/pages/:slug', (c: AppContext) => {
  const t = c.get('t');
  if (c.req.param('slug') !== 'home') return notFound(c, 'Page');
  const h = t.home;
  const spotlight = t.courses.find((x) => x.featured) ?? t.courses[0];
  const certificatesIssued = t.certificates.length + 136;
  const sections: Section[] = [
    {
      id: 'sec_hero',
      kind: 'hero',
      eyebrow: h.hero.eyebrow,
      title: h.hero.title,
      subtitle: h.hero.subtitle,
      primaryCta: { label: 'Browse courses', href: '/courses' },
      secondaryCta: { label: 'My learning', href: '/learning' },
      stats: [
        { value: String(t.courses.length), label: 'courses' },
        { value: avgRating(t), label: 'avg rating' },
        { value: '68%', label: 'completion rate' },
      ],
      spotlight: spotlight ? courseSummary(t, spotlight) : null,
    },
    {
      id: 'sec_featured',
      kind: 'featured_courses',
      title: 'Featured courses',
      courses: t.courses.slice(0, 3).map((x) => courseSummary(t, x)),
    },
    { id: 'sec_topics', kind: 'topics', title: 'Browse by topic', categories: categories(t) },
    {
      id: 'sec_instructor',
      kind: 'instructor',
      eyebrow: 'Meet your instructor',
      title: 'Learn from someone who’s done it',
      instructor: { ...person(t.instructor.name, t.instructor.color), role: t.instructor.role, bio: t.instructor.bio },
      stats: [
        { value: t.instructor.studentCount.toLocaleString(t.site.defaultLocale), label: 'students taught' },
        { value: `${avgRating(t)}★`, label: 'avg course rating' },
        { value: String(certificatesIssued), label: 'certificates issued' },
      ],
      video: { title: h.instructorVideo.title, durationSeconds: h.instructorVideo.durationSeconds, posterUrl: null },
    },
    ...(t.site.features.membership
      ? [
          {
            id: 'sec_membership',
            kind: 'membership_plans' as const,
            title: h.membership.title,
            subtitle: h.membership.subtitle,
            plans: membershipPlans(t),
          },
        ]
      : []),
    {
      id: 'sec_testimonials',
      kind: 'testimonials',
      title: 'What students say',
      items: h.testimonials.map((x) => ({
        quote: x.quote,
        rating: x.rating,
        author: person(x.name, x.color),
        context: t.courses.find((cc) => cc.slug === x.courseSlug)?.title ?? '',
      })),
    },
    { id: 'sec_values', kind: 'value_props', items: h.valueProps },
    { id: 'sec_newsletter', kind: 'newsletter', title: h.newsletter.title, body: h.newsletter.body },
  ];
  const page: Page = {
    slug: 'home',
    title: t.site.name,
    seo: { title: null, description: null },
    sections,
    updatedAt: t.courses[0]?.updatedAt ?? new Date(0).toISOString(),
  };
  return ok(c, page);
});

publicRoutes.get('/membership', (c: AppContext) => {
  const t = c.get('t');
  if (!t.site.features.membership) return notFound(c, 'Membership');
  const m: Membership = { ...t.membership, plans: membershipPlans(t) };
  return ok(c, m);
});

publicRoutes.get('/help', (c: AppContext) => {
  const cats: HelpCategory[] = c
    .get('t')
    .help.map((h) => ({ title: h.title, articles: h.articles.map((a) => ({ slug: slugify(a), title: a })) }));
  return ok(c, cats);
});

publicRoutes.get('/legal/:doc', (c: AppContext) => {
  const slug = c.req.param('doc');
  if (slug !== 'refund' && slug !== 'privacy' && slug !== 'terms') return notFound(c, 'Document');
  const d = c.get('t').legal[slug];
  const doc: LegalDocument = { slug, title: d.title, updatedAt: d.updatedAt, sections: d.sections };
  return ok(c, doc);
});

publicRoutes.post('/newsletter', async (c: AppContext) => {
  const email = str((await body<{ email: string }>(c)).email).toLowerCase();
  if (!isEmail(email)) return invalid(c, { email: 'Enter a valid email address.' });
  const t = c.get('t');
  if (!t.newsletter.includes(email)) t.newsletter.push(email);
  return ok(c, { subscribed: true }, 201);
});

const TOPICS = ['access', 'billing', 'refund', 'certificate', 'other'];

publicRoutes.post('/support/tickets', async (c: AppContext) => {
  const b = await body<SupportTicketInput>(c);
  const user = c.get('user');
  const email = user?.email ?? str(b.email).toLowerCase();
  const message = str(b.message);
  const errors: Record<string, string> = {};
  if (!TOPICS.includes(str(b.topic))) errors.topic = 'Choose a topic.';
  if (message.length < 10) errors.message = 'Add a few more details so we can help — at least 10 characters.';
  if (!isEmail(email)) errors.email = 'Enter a valid email address.';
  if (Object.keys(errors).length) return invalid(c, errors);
  const ticket = { id: id('tkt'), userId: user?.id ?? null, email, topic: str(b.topic), message, createdAt: new Date().toISOString() };
  c.get('t').tickets.push(ticket);
  return ok(c, { id: ticket.id }, 201);
});
