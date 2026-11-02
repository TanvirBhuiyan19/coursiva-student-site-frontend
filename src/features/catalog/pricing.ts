import type { CoursePricing, PricingModel } from './types';

/**
 * The course's pricing model. Course data cached before `pricing` existed reads as one-time (the API always sends
 * it now; a revalidation refreshes the cache).
 */
export const pricingModel = (course: { pricing?: CoursePricing | null }): PricingModel => course.pricing?.model ?? 'one_time';

/**
 * Sold at its list price, so it can sit in a cart: one-time and payment-plan courses. Subscription, pay-what-you-want
 * and membership courses sell from their own page only (the API refuses them in the cart: docs/api/commerce.md).
 */
export const isCartable = (course: { pricing?: CoursePricing | null }) => {
  const model = pricingModel(course);
  return model === 'one_time' || model === 'payment_plan';
};

/** Enrolled in one click, without a checkout: a free course. */
export const isFreeCourse = (course: { pricing?: CoursePricing | null; price: { amount: number } }) =>
  pricingModel(course) === 'free' || (isCartable(course) && course.price.amount === 0);
