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
  checkoutMembership: (planId: string, interval: 'month' | 'year') => `/checkout?plan=${encodeURIComponent(planId)}&interval=${interval}`,
  orderSuccess: (orderId: string) => `/checkout/success/${orderId}`,
  invoice: (orderId: string) => `/orders/${orderId}/invoice`,
  learning: '/learning',
  player: (courseSlug: string, lessonId?: string) => (lessonId ? `/learn/${courseSlug}/${lessonId}` : `/learn/${courseSlug}`),
  community: '/community',
  certificates: '/certificates',
  account: '/account',
  signIn: (next?: string) => withNext('/sign-in', next),
  signUp: (next?: string) => withNext('/sign-up', next),
  forgotPassword: '/forgot-password',
  help: '/help',
  contact: '/contact',
  refund: '/refund-policy',
  privacy: '/privacy',
  terms: '/terms',
} as const;

/** Paths that need a signed-in learner. The proxy redirects guests to sign-in before rendering (optimistic check). */
export const PRIVATE_PREFIXES = ['/learning', '/learn/', '/certificates', '/account', '/wishlist', '/checkout', '/orders/'];

/** Paths that must never be indexed (account areas, transactional pages, auth). */
export const NOINDEX_PREFIXES = [...PRIVATE_PREFIXES, '/cart', '/community', '/sign-in', '/sign-up', '/forgot-password'];

/** Segment-aware prefix match: `/learning` covers `/learning` and `/learning/x`, not `/learnings`. */
const underPrefix = (path: string, prefix: string) => {
  const base = prefix.replace(/\/$/, '');
  return path === base || path.startsWith(`${base}/`);
};

export const isPrivatePath = (path: string) => PRIVATE_PREFIXES.some((p) => underPrefix(path, p));
export const isNoindexPath = (path: string) => NOINDEX_PREFIXES.some((p) => underPrefix(path, p));
