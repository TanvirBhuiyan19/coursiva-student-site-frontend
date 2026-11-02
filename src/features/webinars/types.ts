/** Public webinars. Contract: docs/api/community.md → Webinars (Laravel Live\Tickets\Webinars). */
import type { Money } from '@/lib/api/types';

/**
 * `GET /api/v1/webinars/{slug}` — a session the school made public, for anyone (never cached by the API: each read
 * carries a fresh form token). Only what the page shows: no registrants, no join links.
 */
export interface PublicWebinar {
  id: string;
  slug: string;
  title: string;
  /** Plain text from the dashboard (line breaks kept). */
  description: string;
  startsAt: string;
  durationMin: number;
  status: 'scheduled' | 'live' | 'ended';
  /** The school's time zone (the page shows the visitor's own and names this one). */
  timeZone: string;
  /** Its course; `slug` only when the catalogue shows the course. */
  course: { title: string; slug: string | null } | null;
  access: 'free' | 'paid' | 'members';
  /** The ticket price (paid sessions), else null. */
  price: Money | null;
  /** Null = no capacity limit. */
  seatsLeft: number | null;
  soldOut: boolean;
  /** False once it ended. */
  registrationOpen: boolean;
  /** Bot protection, as the school's public forms: the signed token, Turnstile when the school set it up. */
  form: { token: string; turnstileSiteKey: string | null; minFillSeconds: number };
  calendar: { google: string; outlook: string };
}

/** `POST /api/v1/webinars/{slug}/registrations { name, email, token, website, turnstile_token }`. */
export interface WebinarRegistrationInput {
  name: string;
  email: string;
  token: string;
  /** The honeypot: always empty for people. */
  website: string;
  turnstileToken?: string | null;
}

/**
 * What to do next: `check_email` (registered, or `waitlisted` when full — the email has the personal join link),
 * `checkout` (a paid session: buy the ticket signed in), `membership` (a members-only session).
 */
export interface WebinarRegistration {
  next: 'check_email' | 'checkout' | 'membership';
  status: 'registered' | 'waitlisted' | null;
  checkoutUrlPath?: string;
  membershipUrlPath?: string;
}

/**
 * `POST /api/v1/webinars/join { t }` — the personal join link of the registration emails. A guest account (made by
 * the registration, no password chosen yet) is signed in on this browser (`signedIn`). `401 sign_in_required`: the
 * account has a password — sign in first. `403 join_link_not_yours`, `410` invalid or cancelled.
 */
export interface WebinarJoin {
  sessionId: string;
  signedIn: boolean;
}
