/**
 * Memberships and course subscriptions with the learner's cancel flow and save offers (Laravel
 * Commerce\Memberships\CancelFlow; docs/api/account.md → Subscriptions). The membership row is created on first use
 * from the user's `membershipPlanId`; a course sold as a subscription records one at checkout.
 */
import type { CancelFlow, CancelOffer, CancelReason, LearnerSubscription } from '@/features/account/types';
import { CANCEL_REASONS } from '@/features/account/types';
import { money } from './present';
import type { TenantData, UserRow } from './records';

type Status = LearnerSubscription['status'];

export interface SubscriptionRow {
  id: string;
  userId: string;
  kind: 'membership' | 'course';
  /** The plan id (membership) or the course id. */
  refId: string;
  /** Minor units per interval, locked at sign-up. */
  price: number;
  interval: 'month' | 'year';
  status: Status;
  startedAt: string;
  /** The end of the paid period (the next renewal). */
  periodEnd: string;
  trialEndsAt: string | null;
  resumesAt: string | null;
  endsAt: string | null;
  discount: { percent: number; cycles: number } | null;
  pendingPlanId: string | null;
  pendingPrice: number | null;
}

export interface CancelFlowRow {
  id: string;
  subscriptionId: string;
  offersShown: CancelOffer['key'][];
  reason: CancelReason | null;
  reasonText: string | null;
  acceptedOffer: CancelOffer['key'] | null;
  outcome: 'saved' | 'cancelled' | null;
  createdAt: number;
}

export interface RetentionOffers {
  pause: { enabled: boolean; months: number };
  discount: { enabled: boolean; percent: number; cycles: number };
  downgrade: { enabled: boolean };
}

export interface SubscriptionState {
  rows: SubscriptionRow[];
  flows: CancelFlowRow[];
  offers: RetentionOffers;
}

const FLOW_MS = 60 * 60_000;
let seq = 1;

export function subscriptionState(t: TenantData): SubscriptionState {
  t.subscriptions ??= {
    rows: [],
    flows: [],
    offers: { pause: { enabled: true, months: 1 }, discount: { enabled: true, percent: 30, cycles: 3 }, downgrade: { enabled: true } },
  };
  return t.subscriptions;
}

const addMonths = (iso: string, n: number) => {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString();
};

/** The learner's rows; the membership bought at checkout is picked up from the user record. */
function rowsOf(t: TenantData, user: UserRow): SubscriptionRow[] {
  const state = subscriptionState(t);
  const plan = t.membership.plans.find((p) => p.id === user.membershipPlanId);
  if (plan && user.membershipRenewsAt && !state.rows.some((r) => r.userId === user.id && r.kind === 'membership')) {
    state.rows.push({
      id: `msb_mock${seq++}`,
      userId: user.id,
      kind: 'membership',
      refId: plan.id,
      price: plan.monthly,
      interval: 'month',
      status: 'active',
      startedAt: new Date().toISOString(),
      periodEnd: user.membershipRenewsAt,
      trialEndsAt: null,
      resumesAt: null,
      endsAt: null,
      discount: null,
      pendingPlanId: null,
      pendingPrice: null,
    });
  }
  return state.rows.filter((r) => r.userId === user.id);
}

/** A course sold as a subscription, bought at checkout. */
export function recordCourseSubscription(t: TenantData, user: UserRow, courseId: string, monthlyPrice: number) {
  const state = subscriptionState(t);
  if (state.rows.some((r) => r.userId === user.id && r.kind === 'course' && r.refId === courseId && r.status !== 'cancelled')) return;
  const now = new Date().toISOString();
  state.rows.push({
    id: `msb_mock${seq++}`,
    userId: user.id,
    kind: 'course',
    refId: courseId,
    price: monthlyPrice,
    interval: 'month',
    status: 'active',
    startedAt: now,
    periodEnd: addMonths(now, 1),
    trialEndsAt: null,
    resumesAt: null,
    endsAt: null,
    discount: null,
    pendingPlanId: null,
    pendingPrice: null,
  });
}

const nextCharge = (r: SubscriptionRow) => {
  const base = r.pendingPlanId && r.pendingPrice !== null ? r.pendingPrice : r.price;
  return r.discount ? Math.round((base * (100 - r.discount.percent)) / 100) : base;
};

const reactivatable = (r: SubscriptionRow, now = Date.now()) =>
  r.status === 'cancelled' && r.endsAt !== null && Date.parse(r.endsAt) > now && Date.parse(r.periodEnd) > now;

export function present(t: TenantData, r: SubscriptionRow): LearnerSubscription {
  const billing = r.status === 'active' || r.status === 'trialing' || r.status === 'past_due';
  const course = r.kind === 'course' ? t.courses.find((c) => c.id === r.refId) : undefined;
  const plan = r.kind === 'membership' ? t.membership.plans.find((p) => p.id === r.refId) : undefined;
  return {
    id: r.id,
    kind: r.kind,
    title: course?.title ?? plan?.name ?? '',
    courseSlug: course?.slug ?? null,
    price: money(t, r.price),
    interval: r.interval,
    status: r.status,
    nextCharge: billing ? money(t, nextCharge(r)) : null,
    renewsAt: billing ? r.periodEnd : null,
    trialEndsAt: r.status === 'trialing' ? r.trialEndsAt : null,
    resumesAt: r.status === 'paused' ? r.resumesAt : null,
    endsAt: r.status === 'cancelled' ? r.endsAt : null,
    discount: r.discount,
    pendingPlanName: r.pendingPlanId ? (t.membership.plans.find((p) => p.id === r.pendingPlanId)?.name ?? null) : null,
    canCancel: r.status !== 'cancelled',
    canResume: r.status === 'paused' || reactivatable(r),
  };
}

export function listSubscriptions(t: TenantData, user: UserRow): LearnerSubscription[] {
  const now = Date.now();
  return rowsOf(t, user)
    .filter((r) => r.status !== 'cancelled' || (r.endsAt !== null && Date.parse(r.endsAt) > now))
    .reverse()
    .map((r) => present(t, r));
}

export function findSubscription(t: TenantData, user: UserRow, id: string): SubscriptionRow | undefined {
  return rowsOf(t, user).find((r) => r.id === id);
}

/** The offers this subscription can take now (Active or Trialing only). */
function available(t: TenantData, r: SubscriptionRow): CancelOffer[] {
  if (r.status !== 'active' && r.status !== 'trialing') return [];
  const { offers, flows } = subscriptionState(t);
  // Each save offer is once per subscription.
  const taken = new Set(flows.filter((f) => f.subscriptionId === r.id && f.outcome === 'saved').map((f) => f.acceptedOffer));
  const out: CancelOffer[] = [];
  if (offers.pause.enabled && !taken.has('pause')) {
    const from = Date.parse(r.periodEnd) > Date.now() ? r.periodEnd : new Date().toISOString();
    out.push({ key: 'pause', name: 'Pause instead', months: offers.pause.months, resumesAt: addMonths(from, offers.pause.months) });
  }
  if (offers.discount.enabled && !taken.has('discount') && !r.discount && r.price > 0) {
    const base = r.pendingPlanId && r.pendingPrice !== null ? r.pendingPrice : r.price;
    out.push({
      key: 'discount',
      name: `Stay for ${offers.discount.percent}% off`,
      percent: offers.discount.percent,
      cycles: offers.discount.cycles,
      price: money(t, Math.round((base * (100 - offers.discount.percent)) / 100)),
    });
  }
  if (offers.downgrade.enabled && !taken.has('downgrade') && r.kind === 'membership' && !r.pendingPlanId) {
    const target = t.membership.plans
      .filter((p) => p.id !== r.refId && p.monthly > 0 && p.monthly < r.price)
      .sort((a, b) => b.monthly - a.monthly)[0];
    if (target) out.push({ key: 'downgrade', name: 'Switch to a cheaper plan', planName: target.name, price: money(t, target.monthly) });
  }
  return out;
}

export function startFlow(t: TenantData, r: SubscriptionRow): CancelFlow | { conflict: string } {
  if (r.status === 'cancelled') return { conflict: 'This subscription is already cancelled.' };
  const offers = available(t, r);
  const flow: CancelFlowRow = {
    id: String(seq++),
    subscriptionId: r.id,
    offersShown: offers.map((o) => o.key),
    reason: null,
    reasonText: null,
    acceptedOffer: null,
    outcome: null,
    createdAt: Date.now(),
  };
  subscriptionState(t).flows.push(flow);
  return {
    id: flow.id,
    subscription: present(t, r),
    reasons: [...CANCEL_REASONS],
    offers,
    accessUntil: r.status === 'past_due' ? new Date().toISOString() : r.periodEnd,
  };
}

const openFlow = (t: TenantData, r: SubscriptionRow, flowId: string) =>
  subscriptionState(t).flows.find(
    (f) => f.id === flowId && f.subscriptionId === r.id && f.outcome === null && Date.now() - f.createdAt <= FLOW_MS,
  );

export interface Survey {
  reason: CancelReason | null;
  reasonText: string | null;
}

export function saveOffer(t: TenantData, r: SubscriptionRow, flowId: string, key: CancelOffer['key'], survey: Survey): string | null {
  const flow = openFlow(t, r, flowId);
  if (!flow) return 'This cancellation has expired. Start again.';
  const offer = available(t, r).find((o) => o.key === key);
  if (!offer || !flow.offersShown.includes(key)) return 'This offer is no longer available. Start again to see what we can offer.';
  if (offer.key === 'pause') Object.assign(r, { status: 'paused' satisfies Status, resumesAt: offer.resumesAt });
  if (offer.key === 'discount') r.discount = { percent: offer.percent, cycles: offer.cycles };
  if (offer.key === 'downgrade') {
    const plan = t.membership.plans.find((p) => p.name === offer.planName)!;
    Object.assign(r, { pendingPlanId: plan.id, pendingPrice: plan.monthly });
  }
  Object.assign(flow, { ...survey, acceptedOffer: key, outcome: 'saved' });
  return null;
}

export function cancelSubscription(t: TenantData, r: SubscriptionRow, flowId: string | null, survey: Survey): string | null {
  if (r.status === 'cancelled') return 'This subscription is already cancelled.';
  // Cancelling never depends on the flow: an expired or unknown flow just records a new one.
  let flow: CancelFlowRow | undefined = flowId ? openFlow(t, r, flowId) : undefined;
  if (!flow) {
    flow = {
      id: String(seq++),
      subscriptionId: r.id,
      offersShown: [],
      reason: null,
      reasonText: null,
      acceptedOffer: null,
      outcome: null,
      createdAt: Date.now(),
    };
    subscriptionState(t).flows.push(flow);
  }
  const now = new Date().toISOString();
  Object.assign(r, { endsAt: r.status === 'past_due' ? now : r.periodEnd, status: 'cancelled' satisfies Status });
  Object.assign(flow, { ...survey, outcome: 'cancelled' });
  return null;
}

export function resumeSubscription(r: SubscriptionRow): string | null {
  const now = Date.now();
  if (r.status === 'paused') {
    // Past the paid period a new one starts (and is billed) now.
    if (Date.parse(r.periodEnd) <= now) r.periodEnd = addMonths(new Date().toISOString(), r.interval === 'year' ? 12 : 1);
    Object.assign(r, { status: 'active' satisfies Status, resumesAt: null });
    return null;
  }
  if (reactivatable(r, now)) {
    Object.assign(r, { status: 'active' satisfies Status, endsAt: null });
    return null;
  }
  return 'This subscription has ended. Subscribe again to get access back.';
}

/** For tests: when a flow started (to expire it). */
export const flowAge = (t: TenantData, flowId: string, ms: number) => {
  const f = subscriptionState(t).flows.find((x) => x.id === flowId);
  if (f) f.createdAt -= ms;
};
