/** Amplify's checkout offers (lib/offers.ts): type-only imports, so seeds load without the pricing code. */
import type { OfferRow } from '../lib/offers';

/**
 * Amplify's offers, all on Brand Storytelling Lab (`crs_b`, which no other test buys): a 15% countdown sale (ends two
 * days after the seed loads), team tiers (3+ seats 10%, 5+ seats 25%), Pricing with Confidence 30% off as
 * "frequently bought together", and after paying: Launch Lab 20% off (upsell), then Podcast Launchpad 50% off
 * (downsell). Jordan owns `crs_b`: e2e buys it as a new learner.
 */
export function amplifyOffers(): OfferRow[] {
  const created = '2026-09-01T09:00:00Z';
  const brand = { kind: 'courses' as const, courseIds: ['crs_b'] };
  const base = { enabled: true, startsAt: null, endsAt: null, createdAt: created, body: '', appliesTo: brand };
  return [
    {
      ...base,
      id: 'ofr_spring',
      kind: 'countdown',
      title: 'Spring sale',
      headline: 'Spring sale — 15% off Brand Storytelling Lab',
      endsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      discountPercent: 15,
    },
    {
      ...base,
      id: 'ofr_teams',
      kind: 'quantity',
      title: 'Team pricing',
      headline: '',
      discountPercent: 0,
      tiers: [
        { minSeats: 3, discountPercent: 10 },
        { minSeats: 5, discountPercent: 25 },
      ],
    },
    {
      ...base,
      id: 'ofr_together',
      kind: 'cross_sell',
      title: 'Story + pricing',
      headline: 'Frequently bought together',
      body: 'Price the offer your story sells.',
      discountPercent: 30,
      courseIds: ['crs_w'],
    },
    {
      ...base,
      id: 'ofr_lab',
      kind: 'upsell',
      title: 'Launch Lab upsell',
      headline: 'Add Launch Lab for 20% off',
      body: 'Put your story to work: simulate your launch and get feedback from classmates.',
      discountPercent: 20,
      item: { kind: 'course', id: 'crs_l' },
    },
    {
      ...base,
      id: 'ofr_podcast',
      kind: 'downsell',
      title: 'Podcast downsell',
      headline: '',
      discountPercent: 50,
      item: { kind: 'course', id: 'crs_p' },
    },
  ];
}
