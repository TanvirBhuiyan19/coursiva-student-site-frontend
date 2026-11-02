import type { CheckoutTarget } from '@/features/commerce/types';
/**
 * Storage rows for the mock backend. These are "database" shapes — routes turn them into the API resources defined
 * in src/features/<feature>/types.ts (the contract). Laravel will own the real tables.
 */
import type { Level, LessonType } from '@/features/catalog/types';
import type { Site, SiteBuilderFields, TenantResolution } from '@/features/tenant/types';
import type { Membership } from '@/features/membership/types';
import type { SubscriptionState } from './subscriptions';
import type { OfferEventRow, OfferRow } from './offers';
import type { SocialNetwork } from '@/features/tenant/types';
import type { BlockGateRow, BlockResponseRow } from './blocks';
import type { BuilderState } from './sitebuilder';
import type {
  CompletionRule,
  LiveEvent,
  QuizQuestionType,
  ScanStatus,
  ScormRuntimeKind,
  Segment,
  SurveyField,
  SurveyValue,
  WatermarkPosition,
} from '@/features/learning/types';

export interface QuizQuestionRow {
  id: string;
  /** Default `single_choice`. `free_text` answers are held for the instructor's review. */
  type?: QuizQuestionType;
  prompt: string;
  options: string[];
  /** Correct option index (choice types); `multi_select` uses `answers`. Ignored for free text. */
  answer: number;
  answers?: number[];
  points?: number;
}

/** A SCORM / xAPI package attached to a lesson (the lesson's learner type is `text`, like Laravel's). */
export interface ScormPackageRow {
  id: string;
  runtime: ScormRuntimeKind;
  /** `SCORM 1.2`, `SCORM 2004 4th Edition`, `xAPI (cmi5)`… */
  standard: string;
  version: number;
  tracking: 'Completion only' | 'Completion + score' | 'Full xAPI statements';
  masteryScore: number | null;
  activityId: string;
}

export interface AssignmentRow {
  id: string;
  title: string;
  brief: string;
  points: number;
  dueKind: 'module_gate' | 'end_of_course' | 'weekly';
  dueWeekday: number | null;
  dueAt: string | null;
  reviewMode: 'instructor' | 'peer_instructor';
  peerReviewCount: number;
  peerReviewDays: number;
  latePolicy: 'accepted' | 'accepted_flagged' | 'rejected';
  attempts: number | null;
  fileTypes: string[];
  maxFileMb: number;
  gatesNextModule: boolean;
  rubric: { id: string; label: string; hint: string; max: number }[];
}

export interface LessonRow {
  id: string;
  title: string;
  type: LessonType;
  durationSeconds: number | null;
  freePreview: boolean;
  /** The public outline's one-line description (Laravel `lessons.summary`); absent = none. */
  summary?: string | null;
  questions: QuizQuestionRow[];
  pdfSizeBytes: number | null;
  scorm?: ScormPackageRow;
  assignment?: AssignmentRow;
  /** The school's dynamic watermark applies to this video. */
  watermark?: boolean;
  /** A third-party embed (YouTube/Vimeo player URL) instead of an uploaded file. */
  embedUrl?: string;
  /**
   * When the lesson opens (course builder v2 O4; Laravel `available_mode`): `days` after enrolment, on a `date`, or
   * `after` another lesson is completed. Omitted = inherit (open in the mock).
   */
  available?: { mode: 'days'; days: number } | { mode: 'date'; at: string } | { mode: 'after'; lessonId: string };
  /** Omitted = the type's default (quiz / scorm / assignment, else manual). */
  completionRule?: CompletionRule;
  /** video: % (50–100); time: minutes (1–120). */
  completionValue?: number;
  /**
   * A Survey lesson (Laravel learner type `text`): its Forms & leads form (every field but `email`), the intro shown as
   * `body_html` and whether learners may re-submit.
   */
  survey?: SurveyRow;
  /** A Live lesson's session (the `live_sessions` row it links to). */
  live?: {
    sessionId: string;
    title: string;
    startsAt: string;
    durationMin: number;
    provider: LiveEvent['provider'];
    status: 'scheduled' | 'live' | 'ended';
    /** The published recording's embed, if any. */
    recordingEmbedUrl?: string;
  };
}

export interface SurveyRow {
  formId: string;
  title: string;
  /** Markdown-free plain text in the mock (Laravel renders the author's Markdown to `body_html`). */
  intro: string;
  fields: SurveyField[];
  allowResubmit: boolean;
}

/** `lesson_survey_responses`: one per lesson and learner, replaced on re-submit. */
export interface SurveyResponseRow {
  userId: string;
  lessonId: string;
  answers: { key: string; label: string; type: SurveyField['type']; value: SurveyValue }[];
  submissions: number;
  submittedAt: string;
}

export interface ModuleRow {
  id: string;
  title: string;
  lessons: LessonRow[];
}

export interface CourseRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  description: string;
  categorySlug: string;
  coverColor: string;
  level: Level;
  /** Minor units. */
  price: number;
  rating: number;
  reviewCount: number;
  studentCount: number;
  durationMinutes: number;
  outcomes: string[];
  requirements: string[];
  audience: string[];
  faqs: { question: string; answer: string }[];
  modules: ModuleRow[];
  featured: boolean;
  publishedAt: string;
  updatedAt: string;
  /** The teaching member's profile slug; omitted = the school's main instructor (`TenantData.instructor`). */
  instructorSlug?: string;
  /**
   * How the course sells (Laravel's pricing model); omitted = one-time at `price`. A subscription is billed
   * `monthlyPrice` a month, pay what you want takes any amount from `minimumPrice` (`price` = the suggestion), a
   * membership course is not sold on its own. Only one-time courses go in the cart.
   */
  pricing?:
    { model: 'subscription'; monthlyPrice: number } | { model: 'pay_what_you_want'; minimumPrice: number } | { model: 'membership' };
}

export interface CategoryRow {
  slug: string;
  name: string;
  color: string;
}

export interface InstructorRow {
  name: string;
  initials: string;
  color: string;
  role: string;
  bio: string;
  studentCount: number;
  /** The member's instructor profile (`instructorProfiles[].slug`), if they made one. */
  profileSlug?: string;
}

/**
 * A team member's public instructor profile (Laravel `instructor_profiles`). Visible on the site only while
 * `published` and `active` (the member is still an active team member whose role can teach).
 */
export interface InstructorProfileRow {
  slug: string;
  /** Addresses before a rename: `/redirects/resolve` sends them to the current slug while the profile is visible. */
  formerSlugs: string[];
  /** The member's display name. */
  name: string;
  color: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  headline: string;
  expertise: string[];
  /** What the API renders from the instructor's Markdown (already safe — the mock stores the output). */
  bioHtml: string;
  credentials: { title: string; issuer: string; year: number | null }[];
  socialLinks: { platform: 'linkedin' | 'x' | 'youtube' | 'instagram' | 'facebook' | 'tiktok' | 'github'; url: string }[];
  website: string | null;
  seoTitle: string;
  seoDescription: string;
  published: boolean;
  active: boolean;
  /** Distinct learners across their courses (the mock seeds the figure). */
  learnerCount: number;
  updatedAt: string | null;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  /** A new address waiting for confirmation (the real API emails it a link). */
  pendingEmail?: string | null;
  password: string;
  color: string;
  bio: string;
  createdAt: string;
  timezone: string;
  website: string;
  preferences: { newLessons: boolean; communityReplies: boolean; liveReminders: boolean; certificateReminders?: boolean };
  card: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  membershipRenewsAt: string | null;
  weeklyGoal: number;
  streakDays: number;
  /** Lessons completed per day for the current week, Monday first (seeded activity). */
  weekActivity: number[];
  membershipPlanId: string | null;
}

export interface ReviewRow {
  id: string;
  courseId: string;
  userId: string | null;
  name: string;
  color: string;
  rating: number;
  body: string;
  createdAt: string;
}

/** Where the school collects tax (Laravel `tax_registrations`; `region` is derived from country + subdivision). */
export interface TaxRegistrationRow {
  country: string;
  subdivision: string | null;
  kind: string;
  registered: boolean;
  taxId: string | null;
  /** null = the built-in national rate of the buyer's country. */
  rate: number | null;
  inclusive: boolean;
  reverseCharge: boolean;
}

export interface OrderRow {
  id: string;
  number: string;
  userId: string;
  createdAt: string;
  items: {
    kind: 'course' | 'membership' | 'bundle' | 'product' | 'live';
    refId: string;
    title: string;
    coverColor: string;
    meta: string;
    unitPrice: number;
    quantity: number;
    /** The line's share of the items' tax (minor units). */
    tax?: number;
    /** The list price when an offer lowered it; `offer` marks a cross-sell line. */
    compareAt?: number;
    offer?: 'cross_sell';
  }[];
  subtotal: number;
  discount: number;
  couponCode: string | null;
  orderBump: number;
  tax: number;
  taxRatePercent: number;
  /** The tax line as charged ("VAT (20%)", "Reverse charge"); null = no tax. Older seed rows derive it. */
  taxLabel?: string | null;
  taxInclusive?: boolean;
  reverseCharge?: boolean;
  taxNote?: string | null;
  /** The collecting registration's tax ID (printed as the seller's). */
  sellerTaxId?: string | null;
  /** Assigned when the order is paid (Laravel Invoices::issue). */
  invoiceNumber?: number | null;
  invoicePrefix?: string | null;
  total: number;
  /** Charged today (differs from total for instalment plans). */
  dueToday: number;
  plan: { installments: number; installmentAmount: number } | null;
  paymentMethod: string;
  gift: { recipientEmail: string; message: string; claimUrl: string } | null;
  seats: { quantity: number; claimUrls: string[] } | null;
  billing: { name: string; email: string; country: string; region?: string | null; taxId?: string | null };
  status: 'paid' | 'pending' | 'failed' | 'refunded' | 'partially_refunded';
  /** What was refunded so far (minor units; Laravel orders.refunded_amount). */
  refunded?: number;
  /** One credit note per refund (Laravel credit_notes): number in the `credit_notes` sequence, minor units. */
  creditNotes?: { number: number; prefix: string; amount: number; createdAt: string }[];
  /** What was bought (fulfilment after a 3-D Secure wait). */
  target?: CheckoutTarget;
  /** Affiliate partner slug, its click id and the blog post sent with the checkout (attribution). */
  ref?: string | null;
  refClick?: string | null;
  /** Whether the click was valid for the partner inside the program's window (Laravel Referrals::attribute). */
  refCredited?: boolean;
  post?: string | null;
  /** The gift card's part of `dueToday` (Laravel orders.gift_card_amount) and what was returned to it. */
  giftCard?: { redemptionId: string; code: string; amount: number; refunded: number } | null;
  /** When the payment was captured (default `createdAt`); the thank-you offer is open 30 minutes from it. */
  paidAt?: string | null;
  /** The card kept for the one-click offer after checkout (`saved_<token>`; Laravel orders.offer_payment_reference). */
  offerPaymentReference?: string | null;
  /** The card's brand and last digits (Laravel card_brand / method_detail). */
  cardBrand?: string | null;
  cardLast4?: string | null;
  /** `Post-purchase upsell` / `Post-purchase downsell` for one-click offer orders; omitted = checkout. */
  source?: string;
}

/** A gift card the school issued (Laravel `gift_cards`; minor units). */
export interface GiftCardRow {
  id: string;
  code: string;
  amount: number;
  balance: number;
}

/** One order's use of a gift card (Laravel `gift_card_redemptions`): held → captured, or released. */
export interface GiftCardRedemptionRow {
  id: string;
  giftCardId: string;
  orderId: string;
  amount: number;
  status: 'held' | 'captured' | 'released' | 'refunded';
}

export interface PostRow {
  id: string;
  spaceId: string;
  userId: string | null;
  name: string;
  color: string;
  isCoach: boolean;
  body: string;
  likes: number;
  /** Seeded reply count; once the thread is opened, `thread` holds the replies (generated for seeded posts). */
  replies: number;
  createdAt: string;
  /** Waiting for a moderator (a link from a new member, or 3 reports): left out of the feed. */
  held?: boolean;
  thread?: ReplyRow[];
  flags?: { userId: string; reason: string | null }[];
}

export interface ReplyRow {
  id: string;
  userId: string | null;
  name: string;
  color: string;
  isCoach: boolean;
  body: string;
  createdAt: string;
}

export interface SpaceRow {
  id: string;
  name: string;
  group: string;
  access: 'public' | 'members' | 'course' | 'cohort' | 'paid';
  courseId: string | null;
  description: string;
}

export interface TenantData {
  resolution: TenantResolution;
  /** Branding, settings and entitlements; `GET /site` adds the site builder's chrome (lib/sitebuilder.ts). */
  site: Omit<Site, SiteBuilderFields | 'unavailable'>;
  /**
   * Platform capabilities switched off in the console (Laravel: `availability.switches` + missing connections). Absent =
   * all available; `POST /__mock/availability/{tenant}` sets it.
   */
  unavailable?: string[];
  instructor: InstructorRow;
  /** Instructor profiles, published or not (docs/api/instructors.md). */
  instructorProfiles?: InstructorProfileRow[];
  /**
   * The school's SEO (docs/api/pages.md → SEO): settings, per-page overrides, redirects and the 404 monitor's reports.
   * Absent = the defaults (no redirects).
   */
  /**
   * The partner program's rules the site sees (Laravel `affiliates.program`); absent = the defaults (20% with tiers,
   * last click, 30 days). Partner links of the mock: `maya` (Active).
   */
  affiliateProgram?: {
    commissionType: 'percent' | 'fixed';
    /** Minor units, for a fixed program. */
    fixedAmount: number;
    cookieDays: number;
    attribution: 'first_click' | 'last_click';
    recurring: boolean;
    recurringMonths: number;
  };
  /** Recorded partner clicks (`POST /affiliates/{slug}/clicks`), runtime only. */
  affiliateClicks?: { id: string; partner: string; at: number }[];
  seo?: {
    titleTemplate?: string;
    noindex?: boolean;
    schemaEnabled?: boolean;
    schemaTypes?: Partial<Record<'organization' | 'course' | 'product' | 'breadcrumbs' | 'faq' | 'article' | 'person', boolean>>;
    robotsTxt?: string;
    pages?: {
      path: string;
      title?: string | null;
      description?: string | null;
      noindex?: boolean;
      inSitemap?: boolean;
      canonicalUrl?: string | null;
      ogImageUrl?: string | null;
    }[];
    redirects?: { id: string; from: string; to: string; status: 301 | 302; keepQuery: boolean; hits: number }[];
    notFound?: { path: string; referrerHost: string | null; hits: number; internalHits?: number }[];
  };
  categories: CategoryRow[];
  courses: CourseRow[];
  bundles: { slug: string; title: string; description: string; courseSlugs: string[]; price: number }[];
  /** Published digital downloads (Laravel products of type "Digital download" with a file): `/products/{slug}`. */
  products?: {
    id: string;
    slug: string;
    title: string;
    description: string;
    price: number;
    fileName: string;
    sizeMb: number;
    linkExpiryDays: number;
    downloadLimit: number;
    /** The product's own one-click upsell after it is bought (Laravel products.upsell_product_id). */
    upsellProductId?: string | null;
  }[];
  /** `headline` / `discountPercent`: the bump offer's copy and discount (lib/offers.ts); omitted = none. */
  orderBump: { title: string; description: string; price: number; headline?: string; discountPercent?: number } | null;
  /** Checkout offers (lib/offers.ts) and the thank-you flow's events. */
  offers?: OfferRow[];
  offerEvents?: OfferEventRow[];
  orderPrefix: string;
  /** Invoice copies asked for per learner (timestamps; the 3-per-10-minutes throttle). */
  invoiceEmails?: Record<string, number[]>;
  /** The invoice's seller details (Settings → General business details: address and tax ID). */
  business?: { address: string | null; taxId: string | null };
  /** Orders → Tax registrations (Laravel `tax_registrations`); none = no tax collected anywhere. */
  taxRegistrations?: TaxRegistrationRow[];
  /** `tenant_settings.tax.invoice_prefix` (default "INV-") and the `invoices` sequence's last number. */
  invoicePrefix?: string;
  lastInvoiceNumber?: number;
  lastCreditNoteNumber?: number;
  membership: Omit<Membership, 'plans'> & {
    plans: { id: string; name: string; summary: string; features: string[]; popular: boolean; monthly: number }[];
  };
  home: {
    hero: { eyebrow: string; title: string; subtitle: string };
    instructorVideo: { title: string; durationSeconds: number };
    testimonials: { quote: string; rating: number; name: string; color: string; courseSlug: string }[];
    valueProps: { icon: 'check' | 'infinity' | 'sparkle'; title: string; body: string }[];
    newsletter: { title: string; body: string };
    membership: { title: string; subtitle: string };
  };
  /** Help centre categories; an article is a title (the mock writes a short body) or a title with its Markdown body. */
  help: { title: string; articles: (string | { title: string; body: string })[] }[];
  legal: Record<
    'refund' | 'privacy' | 'terms',
    { title: string; updatedAt: string; intro: string; sections: { heading: string; body: string }[] }
  >;
  footerSocial: SocialNetwork[];
  users: UserRow[];
  enrollments: { userId: string; courseId: string; enrolledAt: string; orderId: string | null }[];
  completions: { userId: string; lessonId: string; at: string }[];
  notes: { userId: string; lessonId: string; body: string }[];
  /** Lesson block answers and passed continue gates (course builder v2 O3), created on first use. */
  blockResponses?: BlockResponseRow[];
  blockGates?: BlockGateRow[];
  quizAttempts: {
    id: string;
    userId: string;
    lessonId: string;
    scorePercent: number | null;
    passed: boolean | null;
    correct: number;
    total: number;
    /** Auto-scored points earned / available, and the written answers' points awaiting review. */
    earned: number;
    autoPoints: number;
    manualPoints: number;
    reviewStatus: 'pending' | 'reviewed' | null;
    feedback: string | null;
    reviewedAt: string | null;
    at: string;
  }[];
  /** Seconds on a lesson from `POST …/time` beats (O4 `lesson_progress.time_spent_sec`), with the beat times (throttle). */
  lessonTime?: { userId: string; lessonId: string; seconds: number; beats: number[] }[];
  /** Survey lesson answers (`POST /me/lessons/{id}/survey`). */
  surveyResponses?: SurveyResponseRow[];
  /** Staff preview check/sort times per preview token (the 60/min throttle; nothing else about a preview is kept). */
  previewHits?: Record<string, number[]>;
  /** Played segments per learner and lesson (the `video` completion rule). */
  videoViews?: { userId: string; lessonId: string; segments: Segment[] }[];
  /** Live attendance (the `live` completion rule). */
  liveAttendance?: { userId: string; sessionId: string }[];
  scormAttempts: {
    userId: string;
    lessonId: string;
    cmi: Record<string, string>;
    completionStatus: string | null;
    successStatus: string | null;
    scoreScaled: number | null;
    totalSeconds: number;
    completedAt: string | null;
    launches: number;
  }[];
  submissions: {
    id: string;
    assignmentId: string;
    lessonId: string;
    userId: string;
    status: 'needs_grading' | 'graded' | 'resubmit';
    attempt: number;
    submittedAt: string;
    lateByDays: number;
    text: string;
    files: { id: string; name: string; ext: string; sizeKb: number; scanStatus: ScanStatus }[];
    grade: { points: number; maxPoints: number; percent: number; feedback: string; gradedAt: string } | null;
    resubmitFeedback: string | null;
  }[];
  peerReviews: {
    id: string;
    assignmentId: string;
    submissionId: string;
    reviewerId: string;
    status: 'assigned' | 'submitted';
    assignedAt: string;
    dueAt: string;
    submittedAt: string | null;
    scores: { criterionId: string; score: number }[] | null;
    percent: number | null;
    comment: string;
  }[];
  /** The school's AI tutor (AI studio). `resting` = the monthly cap is reached. */
  tutor: { enabled: boolean; handoff: boolean; resting: boolean };
  tutorThreads: {
    id: string;
    userId: string;
    courseId: string;
    lessonId: string | null;
    title: string;
    status: 'open' | 'resolved' | 'escalated';
    escalatedAt: string | null;
    resolvedAt: string | null;
    createdAt: string;
    updatedAt: string;
    messages: { id: string; role: 'student' | 'tutor'; text: string; lessonId: string | null; createdAt: string }[];
  }[];
  /** Tutor questions asked (for the 30-an-hour limit). */
  tutorAsks: { userId: string; at: number }[];
  /** Discord (docs/sync.md → Discord): `available` = the school connected Discord with a server and the platform bot. */
  discord: { available: boolean };
  /** One per learner; the Discord user id is unique per school. `needs_relink`: Discord refused the grant. */
  discordLinks: { userId: string; discordUserId: string; username: string; linkedAt: string; status: 'linked' | 'needs_relink' }[];
  /** Stripe can't take charges for this school yet (onboarding unfinished): checkout answers 422 payment_method. */
  chargesBlocked: boolean;
  /** Watermark spec shared by the school's protected videos (null = watermark off). */
  watermark: { opacity: number; color: string; fontSizePct: number; positions: WatermarkPosition[]; intervalSeconds: number } | null;
  lessonQuestions: {
    id: string;
    lessonId: string;
    userId: string | null;
    name: string;
    color: string;
    isCoach: boolean;
    body: string;
    createdAt: string;
  }[];
  reviews: ReviewRow[];
  wishlist: { userId: string; courseId: string }[];
  carts: { owner: string; courseIds: string[] }[];
  orders: OrderRow[];
  spaces: SpaceRow[];
  posts: PostRow[];
  likes: { userId: string; postId: string }[];
  event: { id: string; title: string; startsAt: string; provider: 'zoom' | 'google_meet' | 'teams' | 'built_in'; attendees: number };
  rsvps: { userId: string; eventId: string }[];
  leaderboard: { name: string; points: number; color: string }[];
  /** `kind` is stored (quiz_reviewed, peer_review_assigned, …) but, like Laravel, not sent: the bell shows text + href. */
  notifications: { id: string; userId: string; kind?: string; text: string; href: string; createdAt: string; readAt: string | null }[];
  /** `openBadge`: published as an Open Badges 3.0 credential. */
  certificates: { id: string; userId: string; courseId: string; issuedAt: string; openBadge?: boolean; revoked?: boolean }[];
  tickets: { id: string; userId: string | null; email: string; topic: string; message: string; createdAt: string }[];
  newsletter: string[];
  passwordResets: string[];
  /** Published blog posts (`/blog/posts`); `body` is Markdown. */
  blog?: {
    slug: string;
    title: string;
    excerpt: string;
    body: string;
    publishedAt: string;
    categories: string[];
    author: string;
    comments: { id: string; authorName: string; text: string; createdAt: string }[];
  }[];
  /** Signed download links issued per `orderId:productId` (the mock's download limit is 3). */
  downloadsUsed?: Record<string, number>;
  /** Memberships and course subscriptions with the cancel flow's records and save offers (lib/subscriptions.ts). */
  subscriptions?: SubscriptionState;
  /** `userId:surveyId` pairs already answered (`POST /me/surveys/{id}/answers`). */
  surveyAnswers?: string[];
  /** Gift / team-seat claim tokens already redeemed (`POST /me/claims`). */
  claimedTokens?: string[];
  /** Gift cards redeemable at checkout (seeded on first use: GIFT-TEST-0050, GIFT-HALF-0025, GIFT-USED-0000). */
  giftCards?: GiftCardRow[];
  giftCardRedemptions?: GiftCardRedemptionRow[];
  /** The site builder (lib/sitebuilder.ts): the published document, the draft, preview links, form submissions. */
  builder: BuilderState;
  /** Settings → Privacy (the cookie banner's one source of truth). */
  privacy: { cookieBanner: boolean };
  /** Media library videos the published site uses (`media:<id>` → /api/v1/site/assets/{id}). */
  mediaVideos: string[];
}
