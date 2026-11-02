/**
 * Every public URL of the learner site, in one place. These are the paths the visitor sees on the tenant's host;
 * the proxy maps them onto `app/[tenant]/…`. Paths are English and stable — they are what search engines index.
 */
const withNext = (path: string, next?: string) =>
  next && next.startsWith('/') && !next.startsWith('//') ? `${path}?next=${encodeURIComponent(next)}` : path;

export const routes = {
  home: '/',
  courses: '/courses',
  category: (slug: string) => `/courses?category=${encodeURIComponent(slug)}`,
  course: (slug: string) => `/courses/${slug}`,
  membership: '/membership',
  cart: '/cart',
  wishlist: '/wishlist',
  checkoutCourse: (slug: string, plan?: 'installments') =>
    `/checkout?course=${encodeURIComponent(slug)}${plan ? '&payment=installments' : ''}`,
  checkoutCart: '/checkout?cart=1',
  checkoutBundle: (slug: string) => `/checkout?bundle=${encodeURIComponent(slug)}`,
  checkoutProduct: (slug: string) => `/checkout?product=${encodeURIComponent(slug)}`,
  checkoutMembership: (planId: string, interval: 'month' | 'year') => `/checkout?plan=${encodeURIComponent(planId)}&interval=${interval}`,
  /** A paid live session's ticket; `series`: one ticket for every upcoming session of its series. */
  checkoutLive: (sessionId: string, series = false) => `/checkout?live=${encodeURIComponent(sessionId)}${series ? '&series=1' : ''}`,
  /** `booking`: a service product's checkout (`slot` = a held time was paid, `package` = sessions to book later). */
  orderSuccess: (orderId: string, booking?: 'slot' | 'package') => `/checkout/success/${orderId}${booking ? `?booking=${booking}` : ''}`,
  invoice: (orderId: string) => `/orders/${orderId}/invoice`,
  order: (orderId: string) => `/orders/${orderId}`,
  claim: (token: string) => `/claim?token=${encodeURIComponent(token)}`,
  bundle: (slug: string) => `/bundles/${slug}`,
  product: (slug: string) => `/products/${slug}`,
  instructors: '/instructors',
  instructor: (slug: string) => `/instructors/${slug}`,
  learning: '/learning',
  player: (courseSlug: string, lessonId?: string) => (lessonId ? `/learn/${courseSlug}/${lessonId}` : `/learn/${courseSlug}`),
  community: '/community',
  certificates: '/certificates',
  account: '/account',
  accountDownloads: '/account#downloads',
  accountBilling: '/account/billing',
  accountOrders: '/account/orders',
  accountBookings: '/account/bookings',
  /** A booked session: details, join, calendar, reschedule, cancel (the booking emails' ICS LOCATION links here). */
  accountBooking: (id: string) => `/account/bookings/${id}`,
  survey: (id: string) => `/account?survey=${encodeURIComponent(id)}`,
  /** The learner's live classes: schedule, RSVPs, replays and the calendar feed. */
  liveSchedule: '/live',
  live: (id: string) => `/live/${id}`,
  liveRoom: (id: string) => `/live/${id}/room`,
  /** A public webinar's page (indexable) and the personal join link of its registration emails (`?t=`). */
  webinar: (slug: string) => `/webinars/${slug}`,
  webinarJoin: (token: string) => `/webinars/join?t=${encodeURIComponent(token)}`,
  blog: '/blog',
  blogPost: (slug: string) => `/blog/${slug}`,
  partners: '/partners',
  verifyCertificate: (code: string) => `/verify/${encodeURIComponent(code)}`,
  join: (group: string) => `/join/${group}`,
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
  /** The double opt-in link in a school's "Confirm your subscription" email (`?token=`). */
  subscribeConfirm: '/subscribe/confirm',
  signIn: (next?: string) => withNext('/sign-in', next),
  signUp: (next?: string) => withNext('/sign-up', next),
  forgotPassword: '/forgot-password',
  help: '/help',
  helpArticle: (slug: string) => `/help/${slug}`,
  contact: '/contact',
  refund: '/refund-policy',
  privacy: '/privacy',
  terms: '/terms',
  /** A lead form's hosted page (docs/api/forms.md); `/embed/forms/{id}` is its embed frame. */
  form: (id: string) => `/forms/${encodeURIComponent(id)}`,
  /** The staff preview (course builder O7): the course with `lessonId` open, else its first lesson. */
  preview: (token: string, lessonId?: string) =>
    `/preview/${encodeURIComponent(token)}${lessonId ? `?lesson=${encodeURIComponent(lessonId)}` : ''}`,
} as const;

/** Paths that need a signed-in learner. The proxy redirects guests to sign-in before rendering (optimistic check). */
export const PRIVATE_PREFIXES = [
  '/learning',
  '/learn/',
  '/certificates',
  '/account',
  '/wishlist',
  '/checkout',
  '/orders/',
  '/claim',
  '/live/',
];

/** Paths that must never be indexed (account areas, transactional pages, auth). */
export const NOINDEX_PREFIXES = [
  ...PRIVATE_PREFIXES,
  '/cart',
  '/community',
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/subscribe/',
  '/join/',
  '/webinars/join',
  '/preview/',
  '/forms/',
  '/embed/',
];

/** The staff preview's pages (course builder O7). */
export const PREVIEW_PREFIXES = ['/preview/'];
/** The lead-form embed frame (on other websites): the form alone, no site chrome, banners or cookie prompt. */
export const EMBED_PREFIXES = ['/embed/'];

/**
 * Auth, token, checkout and account pages (passwords, reset and invite tokens, payment): the school's custom head code
 * never runs there (docs/consent.md), and a school redirect can't take them over (`isReservedRedirectPath`).
 */
export const CODE_FREE_PREFIXES = [
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/subscribe/',
  '/claim',
  '/join/',
  '/webinars/join',
  '/checkout',
  '/account',
  '/orders/',
];

/**
 * Paths a school redirect never applies to — the same list as Laravel's RedirectRules::RESERVED and Go's
 * seo.Reserved: the platform's own paths and the code-free pages, also under a language prefix (`/es/sign-in`).
 * Checked when the storefront serves a redirect, so a rule saved before a path was reserved stops working.
 */
export const RESERVED_REDIRECT_PREFIXES = [
  '/api',
  '/sanctum',
  '/_next',
  '/hooks',
  '/__site',
  '/robots.txt',
  '/sitemap.xml',
  '/icon.png',
  ...CODE_FREE_PREFIXES,
  '/subscribe',
  '/join',
  '/orders',
  '/l',
  '/embed',
  '/preview',
];

/** Segment-aware prefix match: `/learning` covers `/learning` and `/learning/x`, not `/learnings`. */
export const underPrefix = (path: string, prefix: string) => {
  const base = prefix.replace(/\/$/, '');
  return path === base || path.startsWith(`${base}/`);
};

export const isPrivatePath = (path: string) => PRIVATE_PREFIXES.some((p) => underPrefix(path, p));
export const isNoindexPath = (path: string) => NOINDEX_PREFIXES.some((p) => underPrefix(path, p));
export const isCodeFreePath = (path: string) => CODE_FREE_PREFIXES.some((p) => underPrefix(path, p));

/** A language prefix (`/es`, `/pt-br`) in front of a path. */
const LOCALE_PREFIX = /^\/[a-z]{2,3}(?:-[a-z0-9]{2,8})?(?=\/)/i;

/** Whether a school redirect may never apply to this path (case-insensitive, with or without a language prefix). */
export function isReservedRedirectPath(path: string): boolean {
  const key = path.toLowerCase().replace(/\/{2,}/g, '/');
  const reserved = (p: string) => RESERVED_REDIRECT_PREFIXES.some((r) => underPrefix(p, r));
  return reserved(key) || reserved(key.replace(LOCALE_PREFIX, ''));
}
