'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { refreshMe, useSession } from '@/features/auth/api';
import { learningKeys } from '@/features/learning/api';
import { api } from '@/lib/api/client';
import type { Cart, CheckoutInput, Order, Quote, QuoteInput, WishlistItem } from './types';

export const commerceKeys = {
  cart: ['commerce', 'cart'] as const,
  wishlist: ['commerce', 'wishlist'] as const,
  quote: (input: QuoteInput) => ['commerce', 'quote', input] as const,
  order: (id: string) => ['commerce', 'order', id] as const,
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
    mutationFn: (input: CheckoutInput) => api.post<Order>('/checkout', input),
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

export function useOrder(id: string) {
  return useQuery({ queryKey: commerceKeys.order(id), queryFn: () => api.get<Order>(`/orders/${encodeURIComponent(id)}`) });
}
