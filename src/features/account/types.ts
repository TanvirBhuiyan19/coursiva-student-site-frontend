/** Profile, notifications, certificates and support. Contract: docs/api/account.md */
import type { Money } from '@/lib/api/types';

export interface Profile {
  name: string;
  email: string;
  bio: string;
  timezone: string;
  website: string;
  initials: string;
  color: string;
  avatarUrl: string | null;
  timezones: { id: string; label: string }[];
  /** The card saved at this school (memberships, payment plans) as the payment provider holds it now. */
  card: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  membership: Membership | null;
  preferences: Preferences;
  /** A new address waiting for its confirmation link (sent to it); `email` stays the account's address until then. */
  pendingEmail: string | null;
}

/**
 * The learner's membership: the live one, or a cancelled one that still gives access until `endsAt`. `renewsAt` is the
 * next charge (null once cancelled or while paused); `trialEndsAt` only while trialing, `resumesAt` only while paused.
 */
export interface Membership {
  planName: string;
  price: Money;
  interval: 'month' | 'year';
  status: 'active' | 'trialing' | 'past_due' | 'paused' | 'cancelled';
  renewsAt: string | null;
  trialEndsAt: string | null;
  resumesAt: string | null;
  endsAt: string | null;
}

/**
 * `GET /api/v1/me/subscriptions` — a membership or a course sold as a subscription: the live ones, and cancelled ones
 * that still give access until `endsAt`. `nextCharge` is the next renewal before tax (a running discount or a pending
 * cheaper plan included), null when nothing renews.
 */
export interface LearnerSubscription {
  id: string;
  kind: 'membership' | 'course';
  title: string;
  courseSlug: string | null;
  price: Money;
  interval: 'month' | 'year';
  status: Membership['status'];
  nextCharge: Money | null;
  renewsAt: string | null;
  trialEndsAt: string | null;
  resumesAt: string | null;
  endsAt: string | null;
  discount: { percent: number; cycles: number } | null;
  pendingPlanName: string | null;
  canCancel: boolean;
  canResume: boolean;
}

export const CANCEL_REASONS = ['too_expensive', 'not_using', 'finished', 'missing_content', 'technical', 'switching', 'other'] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/** A save offer the cancel flow shows, with what it would do. */
export type CancelOffer =
  | { key: 'pause'; name: string; months: number; resumesAt: string }
  | { key: 'discount'; name: string; percent: number; cycles: number; price: Money }
  | { key: 'downgrade'; name: string; planName: string; price: Money };

/** `POST /api/v1/me/subscriptions/{id}/cancel-flow` — a recorded flow: its offers can be taken for an hour. */
export interface CancelFlow {
  id: string;
  subscription: LearnerSubscription;
  reasons: CancelReason[];
  offers: CancelOffer[];
  /** When access ends if the learner cancels now. */
  accessUntil: string;
}

export interface CancelSurvey {
  reason?: CancelReason | null;
  reasonText?: string | null;
}

/** `GET /api/v1/me/downloads` — the digital downloads of the learner's paid orders, newest first. */
export interface Download {
  orderId: string;
  productId: string;
  name: string;
  fileName: string;
  sizeMb: number;
  purchasedAt: string;
  /** When the download window closes (null = never). */
  expiresAt: string | null;
  /** Downloads left (null = unlimited). */
  downloadsLeft: number | null;
  available: boolean;
}

/** `GET /api/v1/me/surveys/{id}` — the one-question survey an e-mail links to (`/account?survey={id}`). */
export interface Survey {
  id: string;
  question: string;
  answered: boolean;
}

/** `POST /api/v1/me/surveys/{id}/answers` → `201`; `409` once answered. A 0–10 score is optional. */
export interface SurveyAnswer {
  score: number | null;
  text: string;
}

export interface Preferences {
  newLessons: boolean;
  communityReplies: boolean;
  liveReminders: boolean;
  /** Certificate expiry reminder emails (the in-app notice always shows). */
  certificateReminders: boolean;
}

export interface ProfileInput {
  name: string;
  email: string;
  bio: string;
  timezone: string;
  website: string;
  /** Required by the API when `email` changes. */
  currentPassword?: string;
}

export interface PasswordInput {
  currentPassword: string;
  password: string;
}

export interface Notification {
  id: string;
  text: string;
  href: string;
  createdAt: string;
  read: boolean;
}

/** Issued by the platform registry, so it outlives the tenant. `verifyUrl` is the school's `/verify/{code}` page. */
export interface Certificate {
  id: string;
  courseTitle: string;
  courseSlug: string;
  learnerName: string;
  instructorName: string;
  issuedAt: string;
  verifyUrl: string;
  linkedInUrl: string;
  pdfUrl: string;
  /** `active` or `revoked` (the API adds it; revoked certificates can't be downloaded). */
  status?: string;
  /** Open Badges 3.0: the learner's signed credential (`certificate-{code}.jwt`), null unless published and not revoked. */
  credentialUrl: string | null;
  /** The registry URL a verifier or wallet fetches the credential from, null unless published. */
  credentialPublicUrl: string | null;
}

/**
 * `GET /api/v1/registry/certificates/{code}` — the public verification record (no email, no internal ids). `404` for an
 * unknown code, or when the school hides verification. Shown at `/verify/{code}` on the issuing school's host.
 */
export interface CertificateVerification {
  code: string;
  url: string;
  status: 'valid' | 'expired' | 'revoked';
  holderName: string;
  courseTitle: string;
  /** Null when the platform hides issuers. */
  issuerName: string | null;
  issuedAt: string;
  expiresAt: string | null;
  reissuedAt: string | null;
  revokedAt: string | null;
}

/**
 * The learner's Discord link (the school's community server). `available` = the school connected Discord with a server;
 * the card is hidden otherwise. `needsRelink`: Discord stopped accepting the grant — roles still follow enrolments, but
 * joining the server waits for a relink.
 */
export interface DiscordLink {
  available: boolean;
  linked: boolean;
  username: string | null;
  linkedAt: string | null;
  needsRelink: boolean;
}

export interface HelpCategory {
  title: string;
  /** `excerpt`: plain text of the article's first ~160 characters (the API derives it from the Markdown body). */
  articles: { slug: string; title: string; excerpt: string }[];
}

/** `GET /api/v1/help/articles/{slug}` — a published help article; `404` for unknown or unpublished slugs. */
export interface HelpArticle {
  slug: string;
  title: string;
  category: string;
  /** The school's Markdown. */
  body: string;
  excerpt: string;
  updatedAt: string;
  /** Up to 5 other articles of the same category, in help-centre order. */
  related: { slug: string; title: string }[];
}

/** `GET /api/v1/help/search?q=` — published articles containing every word of `q`, title matches first, at most 20. */
export interface HelpSearchResult {
  slug: string;
  title: string;
  category: string;
  excerpt: string;
}

export interface LegalDocument {
  slug: 'refund' | 'privacy' | 'terms';
  title: string;
  updatedAt: string;
  sections: { heading: string; body: string }[];
}

export type SupportTopic = 'access' | 'billing' | 'refund' | 'certificate' | 'other';

export interface SupportTicketInput {
  topic: SupportTopic;
  message: string;
  email: string;
}

/**
 * `POST /newsletter`. With the school's double opt-in on, the address is not subscribed yet: `confirmationRequired`
 * means a confirmation email is on its way (the answer is the same for known and new addresses).
 */
export interface NewsletterSignup {
  subscribed: boolean;
  confirmationRequired: boolean;
}
