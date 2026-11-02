'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { refreshMe, useSession } from '@/features/auth/api';
import { learningKeys } from '@/features/learning/api';
import { api } from '@/lib/api/client';
import { checkoutAttribution, conversionSignal } from '@/features/consent/tracking';
import type { PaymentSetup } from './payments';
import type {
  Cart,
  CheckoutInput,
  CheckoutResult,
  CheckoutTarget,
  OfferAcceptResult,
  Order,
  OrderSummary,
  PostPurchaseOffer,
  Quote,
  QuoteInput,
  WishlistItem,
} from './types';

export const commerceKeys = {
  cart: ['commerce', 'cart'] as const,
  wishlist: ['commerce', 'wishlist'] as const,
  quote: (input: QuoteInput) => ['commerce', 'quote', input] as const,
  order: (id: string) => ['commerce', 'order', id] as const,
  orders: (page: number) => ['commerce', 'orders', page] as const,
  offer: (orderId: string) => ['commerce', 'offer', orderId] as const,
};

export function useCart() {
  return useQuery({ queryKey: commerceKeys.cart, queryFn: () => api.get<Cart>('/cart') });
}

export function useAddToCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (courseSlug: string) => api.post<Cart>('/cart/items', { courseSlug }),
    onSuccess: (cart) => {
      qc.setQueryData(commerceKeys.cart, cart);
      void refreshMe(qc);
    },
  });
}

export function useRemoveFromCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (courseSlug: string) => api.delete<Cart>(`/cart/items/${encodeURIComponent(courseSlug)}`),
    onSuccess: (cart) => {
      qc.setQueryData(commerceKeys.cart, cart);
      void refreshMe(qc);
    },
  });
}

export function useWishlist() {
  const { isSignedIn } = useSession();
  const q = useQuery({ queryKey: commerceKeys.wishlist, queryFn: () => api.get<WishlistItem[]>('/me/wishlist'), enabled: isSignedIn });
  return { ...q, data: isSignedIn ? q.data : [] };
}

/** Save/unsave — optimistic, since it's a toggle the learner expects to respond instantly. */
export function useToggleWishlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, saved }: { slug: string; saved: boolean }) =>
      saved
        ? api.put<undefined>(`/me/wishlist/${encodeURIComponent(slug)}`)
        : api.delete<undefined>(`/me/wishlist/${encodeURIComponent(slug)}`),
    onMutate: async ({ slug, saved }) => {
      await qc.cancelQueries({ queryKey: commerceKeys.wishlist });
      const prev = qc.getQueryData<WishlistItem[]>(commerceKeys.wishlist);
      if (prev && !saved)
        qc.setQueryData<WishlistItem[]>(
          commerceKeys.wishlist,
          prev.filter((w) => w.course.slug !== slug),
        );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(commerceKeys.wishlist, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: commerceKeys.wishlist });
      void refreshMe(qc);
    },
  });
}

/** Totals for the checkout page, recomputed by the API whenever an input changes (never on the client). */
export function useQuote(input: QuoteInput, enabled = true) {
  return useQuery<Quote>({
    queryKey: commerceKeys.quote(input),
    queryFn: () => api.post<Quote>('/checkout/quote', input),
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 0,
  });
}

export function useCheckout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CheckoutInput) => {
      // The visit's first-touch hints label the order's source (Analytics → traffic sources); the partner link and the
      // last blog post read credit the affiliate and the post — each only as far as the visitor's cookie choice allows.
      const attribution = checkoutAttribution();
      const acquisition = input.acquisition ?? attribution.acquisition;
      // The partner travels with its click id (the API checks the click against the school's cookie window).
      const partner = input.ref
        ? { ref: input.ref, refClick: input.refClick ?? null }
        : { ref: attribution.ref, refClick: attribution.refClick };
      const post = input.post ?? attribution.post;
      // What the API may use for server-side conversions once the order is paid (docs/api/commerce.md → tracking).
      const tracking = conversionSignal();
      return api.post<CheckoutResult>('/checkout', {
        ...(tracking ? { tracking } : {}),
        ...input,
        ...(acquisition ? { acquisition } : {}),
        ...(partner.ref ? { ref: partner.ref } : {}),
        ...(partner.ref && partner.refClick ? { refClick: partner.refClick } : {}),
        ...(post ? { post } : {}),
      });
    },
    meta: { errorToast: false },
    onSuccess: (order) => {
      qc.setQueryData(commerceKeys.order(order.id), order);
      void qc.invalidateQueries({ queryKey: commerceKeys.cart });
      void qc.invalidateQueries({ queryKey: learningKeys.enrollments });
      void qc.invalidateQueries({ queryKey: learningKeys.dashboard });
      void refreshMe(qc);
    },
  });
}

/**
 * After 3-D Secure the processor's webhook completes the order: read it until it is paid (about 15 s at most). Returns
 * the last read either way; a still-pending order shows as "processing" on the success page.
 */
export async function waitForPayment(id: string, tries = 10, delayMs = 1500): Promise<Order | null> {
  let last: Order | null = null;
  for (let i = 0; i < tries; i++) {
    try {
      last = await api.get<Order>(`/orders/${encodeURIComponent(id)}`);
      // Settled either way: paid, or the bank refused it.
      if (last.status !== 'pending') return last;
    } catch {
      // A blip while the bank finishes: keep trying.
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

/** Redeems a gift or team-seat link (`/claim?token=`) for the signed-in learner. */
export function useClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.post<{ claimed: boolean; courseSlug: string | null }>('/me/claims', { token }),
    meta: { errorToast: false },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: learningKeys.enrollments });
      void qc.invalidateQueries({ queryKey: learningKeys.dashboard });
    },
  });
}

/** The learner's order history (`GET /me/orders`), one page of 10 at a time, newest first. */
export function useOrders(page: number) {
  return useQuery({
    queryKey: commerceKeys.orders(page),
    queryFn: () => api.page<OrderSummary>(`/me/orders?page=${page}&per_page=10`),
    placeholderData: keepPreviousData,
  });
}

/** Emails a copy of the invoice to the learner's own address (`202 { sent, email }`; 3 per 10 minutes). */
export function useEmailInvoice() {
  return useMutation({
    mutationFn: (orderId: string) => api.post<{ sent: boolean; email: string }>(`/me/orders/${encodeURIComponent(orderId)}/invoice/email`),
    meta: { errorToast: false },
  });
}

/** One order. A pending one (3-D Secure finishing at the processor) is re-read every 3 s until it settles. */
export function useOrder(id: string) {
  return useQuery({
    queryKey: commerceKeys.order(id),
    queryFn: () => api.get<Order>(`/orders/${encodeURIComponent(id)}`),
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 3000 : false),
  });
}

/**
 * The thank-you page's one-click offer for a paid order (`GET /orders/{id}/offer`; null = none). Read once: each read
 * counts as a view, and the decisions below put the next state in the cache.
 */
export function usePostPurchaseOffer(orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: commerceKeys.offer(orderId),
    queryFn: () => api.get<PostPurchaseOffer | null>(`/orders/${encodeURIComponent(orderId)}/offer`),
    enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** "No thanks": the API answers the next offer (the downsell after the upsell) or null, which replaces this one. */
export function useDeclineOffer(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api.post<PostPurchaseOffer | null>(`/orders/${encodeURIComponent(orderId)}/offer`, { key, accept: false }),
    meta: { errorToast: false },
    onSuccess: (next) => qc.setQueryData(commerceKeys.offer(orderId), next),
  });
}

/** "Add to my order": books a new order and charges the card saved at checkout (`nextAction` = 3-D Secure). */
export function useAcceptOffer(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api.post<OfferAcceptResult>(`/orders/${encodeURIComponent(orderId)}/offer`, { key, accept: true }),
    meta: { errorToast: false },
    onSuccess: (order) => {
      qc.setQueryData(commerceKeys.order(order.id), order);
      void qc.invalidateQueries({ queryKey: learningKeys.enrollments });
      void qc.invalidateQueries({ queryKey: learningKeys.dashboard });
      void refreshMe(qc);
    },
  });
}

/**
 * How to run the bank's challenge for a one-click offer: the payment setup of the checkout just completed (still in the
 * cache), else a quote for the offered item (`Quote.payment` is the only place the API sends it).
 */
export async function offerPaymentSetup(qc: ReturnType<typeof useQueryClient>, item: PostPurchaseOffer['item']): Promise<PaymentSetup> {
  const cached = qc.getQueriesData<Quote>({ queryKey: ['commerce', 'quote'] }).find(([, q]) => q?.payment)?.[1]?.payment;
  if (cached) return cached;
  const target: CheckoutTarget =
    item.kind === 'course'
      ? { kind: 'course', courseSlug: item.slug }
      : item.kind === 'bundle'
        ? { kind: 'bundle', bundleSlug: item.slug }
        : { kind: 'product', productSlug: item.slug };
  return (await api.post<Quote>('/checkout/quote', { target })).payment;
}
