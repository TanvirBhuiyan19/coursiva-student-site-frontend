/** Service products and 1:1 bookings. Contract: docs/api/commerce.md (booking) and docs/api/account.md (me/bookings). */

export type LocationType = 'video' | 'zoom' | 'meet' | 'teams' | 'phone' | 'in_person';

/** A question the learner answers when booking (the school sets them per service). */
export interface IntakeQuestion {
  /** `[a-z0-9_]{1,40}` — the key in `BookInput.answers`. */
  key: string;
  label: string;
  type: 'text' | 'textarea';
  required: boolean;
}

/** `ProductPage.service` for `kind: 'service'`: how a session works. Prices stay on the product. */
export interface ServiceInfo {
  sessionMinutes: number;
  /** Sessions one purchase gives (1 = a single session, 5 = "Package of 5 sessions"). */
  sessions: number;
  locationType: LocationType;
  intakeQuestions: IntakeQuestion[];
  /** The learner may cancel or reschedule until this many hours before the start. */
  cancelNoticeHours: number;
}

export interface Slot {
  startsAt: string;
  endsAt: string;
}

/**
 * `GET /api/v1/products/{slug}/availability?from&days&timezone` (public, `no-store`): bookable starts grouped by the
 * learner's local date (`timezone`), only days with slots. `422 timezone` for an unknown zone.
 */
export interface Availability {
  timezone: string;
  slotMinutes: number;
  days: { date: string; slots: Slot[] }[];
}

export type BookingStatus = 'held' | 'confirmed' | 'cancelled' | 'no_show' | 'completed' | 'expired';

/** `GET /api/v1/me/bookings/{id}` — one of the learner's sessions. */
export interface LearnerBooking {
  id: string;
  status: BookingStatus;
  product: { slug: string | null; title: string };
  startsAt: string;
  endsAt: string;
  /** The learner's zone when they booked (what the emails use). */
  timezone: string;
  host: { name: string };
  /** `detail` (address, call instructions) only for phone and in-person sessions. */
  location: { type: LocationType; detail: string | null };
  /** The join button works now (15 minutes before the start until the end). */
  joinAvailable: boolean;
  /** A held slot (waiting for payment) is released at this time. */
  holdExpiresAt: string | null;
  canCancel: boolean;
  canReschedule: boolean;
  cancelNoticeHours: number;
  cancelReason: string | null;
  answers: { key: string; label: string; value: string }[];
}

/** Sessions left from a package the learner bought (book without paying). */
export interface BookingCredit {
  productSlug: string;
  productTitle: string;
  remaining: number;
  total: number;
  packageId: string;
}

/** `GET /api/v1/me/bookings` — upcoming (soonest first, incl. live holds) and past (latest 50), plus credits. */
export interface MyBookings {
  upcoming: LearnerBooking[];
  past: LearnerBooking[];
  credits: BookingCredit[];
}

/**
 * `POST /api/v1/products/{slug}/bookings`. `answers` maps each intake question's `key` to the answer (keys are
 * `[a-z0-9_]`, so they cross the case conversion unchanged); `phone` is required for phone sessions.
 */
export interface BookInput {
  startsAt: string;
  timezone: string;
  answers?: Record<string, string>;
  phone?: string;
}

/**
 * → `201`: `confirmed` (paid with a credit, or free) or `checkout` (the slot is held for 15 minutes: pay at
 * `checkoutUrlPath`). `409` "That time was just taken. Pick another time." when someone got there first.
 */
export type BookResult =
  { booking: LearnerBooking; next: 'confirmed' } | { booking: LearnerBooking; next: 'checkout'; checkoutUrlPath: string };

/** `POST /api/v1/me/bookings/{id}/join` — the built-in room (Daily) or the meeting link of a BYO provider. */
export type JoinInfo = { kind: 'room'; roomUrl: string; token: string; expiresAt: string } | { kind: 'link'; joinUrl: string };
