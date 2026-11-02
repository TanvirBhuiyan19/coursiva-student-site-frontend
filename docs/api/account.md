# Account — profile, Discord, notifications, certificates, support, content

| Endpoint                                     | Auth    | Result                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/me/profile`                     | learner | `Profile` — details, `timezones[]` to pick from, `card`, `membership`, `preferences`                                                                                                                                                                                                                                              |
| `PATCH /api/v1/me/profile`                   | learner | `{ name, email, current_password, bio ≤ 500, timezone, website }` → `Profile`; `422`. A new `email` needs `current_password` and waits in `pending_email` (below)                                                                                                                                                                 |
| `PUT /api/v1/me/password`                    | learner | `{ current_password, password ≥ 8 }` → `{ updated }`; `422`                                                                                                                                                                                                                                                                       |
| `PUT /api/v1/me/preferences`                 | learner | `{ new_lessons, community_replies, live_reminders, certificate_reminders? }` → `Preferences` (a switch left out keeps its value)                                                                                                                                                                                                  |
| `GET /api/v1/me/billing-portal?return=`      | learner | `302` to the payment provider's billing portal (Stripe Customer Portal), back to `return`; with `Accept: application/json` → `{ data: { url } }`. `409` with `message` when no card is saved at this school (memberships / payment plans); `503` when Stripe is unreachable. `return` is a site path (default `/account/billing`) |
| `GET /api/v1/me/surveys/{id}`                | learner | `Survey { id, question, answered }` — the one-question survey an e-mail links to (`/account?survey={id}`); `404`                                                                                                                                                                                                                  |
| `POST /api/v1/me/surveys/{id}/answers`       | learner | `{ score?: 0..10, text }` (one of them) → `201`; `409` once answered                                                                                                                                                                                                                                                              |
| `GET /api/v1/registry/certificates/{code}`   | —       | `CertificateVerification { code, url, status, holder_name, course_title, issuer_name, issued_at, expires_at, reissued_at, revoked_at }`; `404`                                                                                                                                                                                    |
| `GET /api/v1/me/export`                      | learner | GDPR export of everything held about the learner in this school (JSON attachment)                                                                                                                                                                                                                                                 |
| `GET /api/v1/me/discord`                     | learner | `DiscordLink` (below)                                                                                                                                                                                                                                                                                                             |
| `GET /api/v1/me/discord/link?next=`          | learner | full-page navigation: `302` to Discord, back on `next` with `?discord=linked` or `?discord=error&reason=…`                                                                                                                                                                                                                        |
| `DELETE /api/v1/me/discord`                  | learner | `204` (also when nothing was linked)                                                                                                                                                                                                                                                                                              |
| `GET /api/v1/me/notifications`               | learner | `Notification[]` newest first                                                                                                                                                                                                                                                                                                     |
| `POST /api/v1/me/notifications/read-all`     | learner | `{ read: true }`                                                                                                                                                                                                                                                                                                                  |
| `GET /api/v1/me/certificates`                | learner | `Certificate[]`                                                                                                                                                                                                                                                                                                                   |
| `GET /api/v1/help`                           | —       | `HelpCategory[]` (cached, `t:<slug>:content`)                                                                                                                                                                                                                                                                                     |
| `GET /api/v1/legal/{refund\|privacy\|terms}` | —       | `LegalDocument` (cached, `t:<slug>:content`)                                                                                                                                                                                                                                                                                      |
| `POST /api/v1/support/tickets`               | —       | `{ topic: access\|billing\|refund\|certificate\|other, message ≥ 10, email }` → `201 { id }` (email comes from the session when signed in)                                                                                                                                                                                        |

## Billing (`/account/billing`)

`Profile.card` and `Profile.membership` (only on `GET`/`PATCH /me/profile`; `/me` leaves them out):

```jsonc
{
  // The card saved at this school (memberships, payment plans) as the payment provider holds it now: the customer's
  // default payment method (what the learner set in the billing portal), else the one saved at checkout. Read from
  // Stripe and cached 10 minutes; opening the billing portal forgets it. null: nothing on file, or Stripe unreachable.
  "card": { "brand": "visa", "last4": "4242", "exp_month": 4, "exp_year": 2028 },
  // The membership (tiers only; a course sold as a subscription is not one): the live one, else a cancelled one that
  // still gives access. null: none.
  "membership": {
    "plan_name": "Pro",
    "price": { "amount": 4900, "currency": "USD" }, // per interval, locked at sign-up
    "interval": "month", // month | year
    "status": "active", // active | trialing | past_due | paused | cancelled
    "renews_at": "2026-11-01T00:00:00Z", // the next charge; null once cancelled or while paused
    "trial_ends_at": null, // trialing only
    "resumes_at": null, // paused only
    "ends_at": null, // cancelled only: access lasts until then
  },
}
```

The page shows the card ("Card ending 4242 · Expires 04/28"), the plan with its status, a "payment failed" alert while
`past_due` (the dunning emails link here), and one button to the billing portal (`GET /me/billing-portal`): "Update
card" (past due, or a card without a membership) or "Manage plan". Renewals and instalments charge the customer's
current default card, so a card changed in the portal is used from the next charge. It links to the order history.

## Subscriptions (`/account/billing`)

Memberships and courses sold as a subscription, with the learner's own cancel flow. Cancelling online is as easy as
signing up: the exit survey is optional, every save offer can be declined, and cancelling takes one confirmation. Access
continues until the end of the period already paid for (at once when a payment is past due), and the learner can undo
it until then. The billing page lists them under "Subscriptions" (the membership is shown there instead of in the card
section).

Each change the learner makes — cancelling, pausing (the pause offer), resuming, or undoing a cancellation — is
confirmed by email (access-until date, billing-resume date or next payment, and a link back to `/account/billing`).

| Endpoint                                         | Auth    | Result                                                                                                                                                                                                           |
| ------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/me/subscriptions`                   | learner | `LearnerSubscription[]` newest first: live ones, and cancelled ones that still give access                                                                                                                       |
| `POST /api/v1/me/subscriptions/{id}/cancel-flow` | learner | `201 CancelFlow`: records the flow with the offers it shows. `404` (not the learner's), `409` already cancelled                                                                                                  |
| `POST /api/v1/me/subscriptions/{id}/save`        | learner | `{ flow_id, offer: pause\|discount\|downgrade, reason?, reason_text? }` → `LearnerSubscription`. `409` when the flow is over an hour old or ended, or the offer isn't available now; `422`                       |
| `POST /api/v1/me/subscriptions/{id}/cancel`      | learner | `{ flow_id?, reason?, reason_text? }` → `LearnerSubscription` (`cancelled`, `ends_at`). Without `flow_id` (or with an expired one) the cancellation is recorded as a new flow. `409` already cancelled; `422`    |
| `POST /api/v1/me/subscriptions/{id}/resume`      | learner | → `LearnerSubscription`. Paused: billing carries on at the end of a paid period still running, else a new period is billed now. Cancelled with access left: billing continues at the period end. `409` otherwise |

Writes: 20 a minute per learner. `reason` is one of `too_expensive`, `not_using`, `finished`, `missing_content`,
`technical`, `switching`, `other`; `reason_text` ≤ 500 (trimmed). Erasing the learner drops `reason_text`.

```jsonc
// LearnerSubscription
{
  "id": "msb_…",
  "kind": "membership", // membership | course
  "title": "Pro", // the plan's name, or the course's title
  "course_slug": null, // a course subscription's course
  "price": { "amount": 4900, "currency": "USD" }, // per interval, locked at sign-up
  "interval": "month",
  "status": "active", // active | trialing | past_due | paused | cancelled
  "next_charge": { "amount": 3430, "currency": "USD" }, // the next renewal before tax; null when nothing renews
  "renews_at": "2026-11-01T00:00:00Z",
  "trial_ends_at": null,
  "resumes_at": null, // paused: when billing resumes
  "ends_at": null, // cancelled: access lasts until then
  "discount": { "percent": 30, "cycles": 3 }, // a save offer's discount still running (renewals left), else null
  "pending_plan_name": null, // a save offer's cheaper plan, from the next renewal
  "can_cancel": true,
  "can_resume": false,
}
// CancelFlow
{
  "id": "42",
  "subscription": { /* LearnerSubscription */ },
  "reasons": ["too_expensive", "not_using", "finished", "missing_content", "technical", "switching", "other"],
  "offers": [ // the school's save offers this subscription can take now (Active or Trialing only; none when past due or paused)
    { "key": "pause", "name": "Pause instead", "months": 1, "resumes_at": "2026-12-01T00:00:00Z" },
    { "key": "discount", "name": "Stay for 30% off", "percent": 30, "cycles": 3, "price": { "amount": 3430, "currency": "USD" } },
    { "key": "downgrade", "name": "Switch to a cheaper plan", "plan_name": "Starter", "price": { "amount": 1900, "currency": "USD" } }, // memberships only
  ],
  "access_until": "2026-11-01T00:00:00Z", // when access ends if the learner cancels now
}
```

The offers (set by the school on the dashboard's Retention tab; all off until the school turns them on, and each can be
taken once per subscription): **pause** stops billing until the end of the paid period plus N months, then resumes and
bills on its own — access pauses too: the courses stay until the end of the period already paid for and come back when
billing resumes; **discount** charges the next N renewals P% less; **downgrade** moves to the next cheaper membership
plan (that accepts sign-ups) from the next renewal, and the courses only the old plan gave end then. The dialog: survey
(optional) → offers (if any; "No thanks, continue to cancel") → confirmation. Cancelling never depends on the flow: a
`cancel` with an expired or unknown `flow_id` still cancels (a new flow is recorded). A double `resume` bills once; the
second answers `409`.

## Changing the email address

`PATCH /me/profile` with a new `email` also needs `current_password` (`422` on `current_password`: "The current password
field is required when changing your email." / "The current password is incorrect."). The account keeps its current
address (sign-in, receipts) and the new one waits in `Profile.pending_email` (`null` when nothing is pending); the
confirmation link goes to the **new** address. Opening it (`/verify-email?token`, `POST /auth/email/verify`) makes it
the account's email (`409` "Another account in this school already uses this email." if someone took it meanwhile).
Sending the current address again drops the pending change. `POST /auth/email/verification-notification` resends the
link to the pending address. The account form shows "Confirm {pending_email}: we sent you a link." under the field.

## Discord

The school's community server (Laravel: `backend/docs/sync.md` → Discord). The account page shows a "Discord community"
card only when `available` is true.

```jsonc
// GET /api/v1/me/discord → DiscordLink
{
  "data": {
    "available": true, // the school connected Discord with a server (and the platform has the bot)
    "linked": true,
    "username": "jordan.tate", // null when not linked
    "linked_at": "2026-10-05T09:12:00Z", // null when not linked
    "needs_relink": false, // linked, but Discord stopped accepting the grant: shown with a warning + "Link again"
  },
}
```

- **Link / link again**: a full-page navigation (an `<a href>`) to `/api/v1/me/discord/link?next=<the page's own path,
with the /<lang> prefix>`; Laravel 302s to Discord (`identify guilds.join`). `next` must be a same-site path
  (default `/account`). The learner lands back on `next` with `?discord=linked`, or `?discord=error&reason=` one of
  `not_available` (the school has no Discord), `denied` (cancelled on Discord), `expired` (the attempt timed out),
  `exchange_failed` (Discord's token exchange failed) or `already_linked` (that Discord account belongs to another
  learner of the school). The site shows a success or error alert (unknown reasons read as a generic message) and
  strips `discord`/`reason` from the URL (`features/account/discord.ts`).
- **Device clients (mobile app, `Authorization: Bearer <device token>`)**: a token can't travel into the system
  browser, so `GET /api/v1/me/discord/link?next=` with a device token answers `200
{ data: { url, expires_at } }` instead of the 302 (`409` with `reason: "not_available"` when the school has no
  Discord). `url` is `https://<school host>/api/v1/discord/start?code=<64 hex>`: single use, valid 120 seconds and
  bound to that learner and school. The app opens it in the system browser (not a web view); Laravel 302s to Discord
  and binds the attempt to that browser with an httpOnly `coursiva_discord_flow` cookie (path `/api/v1/discord`,
  SameSite=Lax). Discord's callback ends at `GET /api/v1/discord/complete?code=` (public, needs that cookie), which
  stores the link and lands on `next?discord=linked` / `?discord=error&reason=…` (same reasons; a spent, expired or
  foreign code is `expired`). No session or token is created in the browser. When the app returns to the
  foreground it refetches `GET /me/discord`. The browser flow above is unchanged (the site never uses this).
- **Unlink**: `DELETE /api/v1/me/discord` → `204`; the site then refetches `GET /me/discord`. Laravel removes the
  roles Coursiva gave and revokes the grant at Discord (queued); the member isn't kicked.
- The mock links a made-up account without Discord (`?mock_reason=` simulates a failure); Amplify has Discord, Northwind
  doesn't.

## Certificates

Issued by the **platform registry**, so a credential stays verifiable if the school closes, rebrands or is
suspended. `verify_url` is `https://<school's primary host>/verify/<id>` (the site's public verification page, below;
`PLATFORM_CERTIFICATE_VERIFY_HOST` can point it at one platform-wide verify site instead); `linked_in_url` is a
pre-filled "Add to profile" link; `pdf_url` downloads the certificate PDF. The API also sends `status`.

**Open Badges 3.0** (when the school publishes them): `credential_url` (null unless published and not revoked) is the
learner's download — `GET /api/v1/me/certificates/{code}/credential` → `certificate-{code}.jwt`
(`application/vc+jwt`; `403` revoked, `404` not published) — shown as "Download Open Badge" (a plain download through
the `/api` proxy). `credential_public_url` (null unless published) is the registry URL a verifier or wallet fetches;
the site links it as "Open Badge link".

**Notifications** are `{ id, kind, text, href, created_at, read }` — `kind` (≤ 40 chars) is informational; the site
renders `text` + `href`, so new kinds need no site change. Assessment notices link to the lesson: `quiz_reviewed` (the quiz lesson), `peer_review_assigned`
and `peer_review_reminder` (the assignment lesson, where the peer reviews are), `deadline_reminder` (the assignment
lesson) and `file_quarantined` (the assignment lesson; the file shows as quarantined).

## Digital downloads (purchased products)

Laravel `ProductDownloads` (tenant-dashboard `docs/api/products.md`). The account page's "Downloads" card lists them
(hidden when there are none); each button asks for a fresh link and starts a plain download, and `409` reasons show
as messages under the file.

- `GET /api/v1/me/downloads` → `[{ order_id, product_id, name, file_name, size_mb, purchased_at, expires_at,
downloads_left, available }]` — the digital downloads of the learner's paid orders, newest first (an order bump is
  its own order). Refunded or disputed orders drop out.
- `POST /api/v1/me/downloads/{order}/{product}/link` → `{ url, expires_at }`: a 15-minute signed URL (open it as a
  plain download); each link counts. `404` not the learner's purchase, `403` refunded/disputed, `409` with `reason`
  `download_expired` (the product's `link_expiry_days` after payment), `download_limit` (its `download_limit` used) or
  `file_unavailable`. PDFs are stamped with the buyer's email when the school's PDF stamping is on.

## Bookings (`/account/bookings`, `/account/bookings/{id}`)

The learner's 1:1 sessions (service products, commerce.md → Service products; types in
`src/features/bookings/types.ts`). The account page shows a "Bookings" card (hidden when the learner has none) linking
to `/account/bookings`: sessions left to book (each with "Book a session" → the product page), upcoming sessions and
past ones. `/account/bookings/{id}` is the session page — and the **join page**: the booking e-mails' calendar invites
put `{site}/account/bookings/{id}` in LOCATION for online sessions.

`LearnerBooking { id, status: 'held'|'confirmed'|'cancelled'|'no_show'|'completed'|'expired', product { slug | null,
title }, starts_at, ends_at, timezone (the learner's, when booked), host { name }, location { type, detail | null },
join_available, hold_expires_at | null, can_cancel, can_reschedule, cancel_notice_hours, cancel_reason | null,
answers [{ key, label, value }] }` — `completed` = a confirmed session that has ended; `location.detail` (address, call
instructions) only for `phone` and `in_person`; `join_available` from 15 minutes before the start until the end.

| Endpoint                                    | Result                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/me/bookings`                   | `{ upcoming: LearnerBooking[] (soonest first; live holds included), past: LearnerBooking[] (latest 50, newest first), credits: [{ product_slug, product_title, remaining, total, package_id }] }`; lapsed holds are left out                                                                                                                                              |
| `GET /api/v1/me/bookings/{id}`              | `LearnerBooking`; `404` for other learners                                                                                                                                                                                                                                                                                                                                |
| `POST /api/v1/me/bookings/{id}/reschedule`  | `{ starts_at, timezone? }` → `LearnerBooking`. Only confirmed sessions, at least `cancel_notice_hours` before the start (`422 starts_at` "It’s too late to reschedule this session."), at most 3 times (`422 starts_at` "You’ve rescheduled this session the maximum number of times."); the new time must be open (`409` "That time was just taken. Pick another time.") |
| `POST /api/v1/me/bookings/{id}/cancel`      | `{ reason? (≤ 500) }` → `LearnerBooking`. A hold just lapses (`expired`). A confirmed session at least `cancel_notice_hours` before the start → `cancelled` (else `422 booking` "It’s too late to cancel this session."): its credit comes back, or a single paid session is refunded in full                                                                             |
| `POST /api/v1/me/bookings/{id}/join`        | `video` → `{ kind: 'room', room_url, token, expires_at }` (a fresh Daily meeting token per join); `zoom`/`meet`/`teams` → `{ kind: 'link', join_url }` (`409` "The meeting link isn’t ready yet."); `phone`/`in_person` → `409` "This session isn’t online."; before the window `409` "You can join from 15 minutes before the start."                                    |
| `GET /api/v1/me/bookings/{id}/calendar.ics` | `text/calendar` (UID `{id}@{site host}`, SEQUENCE, DTSTART/DTEND in UTC, LOCATION = the session page for online sessions, else the address; CRLF, folded at 75 octets)                                                                                                                                                                                                    |

The session page shows the time in the booking's zone ("Sunday, October 25, 2026 · 1:00 – 2:00 PM (Europe/London)"),
where, the host and the learner's answers. Buttons: **Join session** (the built-in room opens on the page with the
token — the same Daily frame as live classes; a provider's link opens in a new tab), **Add to calendar** (the `.ics`),
**Reschedule** (the same slot picker, only when `can_reschedule`) and **Cancel session** (optional reason, only when
`can_cancel`), with the policy "You can cancel or reschedule up to {cancel_notice_hours} hours before the start." —
inside the window it says the session can't be changed any more. A held time shows "Held until …" with **Pay to
confirm** (`/checkout?product={slug}`).

The mock's choices where the spec is silent: `409` "Only booked sessions can be rescheduled." for a held, cancelled or
past session; `409` "This session is already cancelled." when cancelling a cancelled/expired one (a completed or
no-show one is `422 booking` "It’s too late to cancel this session."); join on a non-confirmed session `409` "This
session isn’t booked.", after the end `409` "This session has ended.".

## Marketing-email links (served by Laravel on the school's host, no sign-in)

The school's campaign and automation emails link here; the site only needs its `/api` proxy to pass them through.

| Endpoint                           | Notes                                                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/mail/o/{token}`       | 1×1 GIF open pixel (`Cache-Control: no-store`)                                                                                         |
| `GET /api/v1/mail/c/{token}?u=&s=` | `302` to the signed destination `u`; `404` HTML page when the signature doesn't match                                                  |
| `GET /api/v1/mail/u/{token}`       | HTML confirmation page with an "Unsubscribe" button (link scanners can't unsubscribe anyone)                                           |
| `POST /api/v1/mail/u/{token}`      | one-click unsubscribe (RFC 8058, also the page's button): the address joins the school's suppression list → HTML "You're unsubscribed" |

Tokens are HMAC-signed per school; a bad token changes nothing.

**Survey links**: the one-question survey email links to `/account?survey={id}`; the page loads `GET /me/surveys/{id}`
and answers with `POST /me/surveys/{id}/answers` (`{ score?, text? }` → `201`; `409` when already answered).

## Certificate verification page

`/verify/{code}` on the issuing school's host (public, `noindex`, Open Graph tags for share previews) reads the
platform registry server-side (`GET /api/v1/registry/certificates/{code}`, cached 60 s) and shows the status, holder,
course, dates and issuer. Laravel builds `verify_url` as `https://<school's primary host>/verify/<code>`; with
`PLATFORM_CERTIFICATE_VERIFY_HOST` set it points at that platform-wide verify site instead (`https://<host>/<code>`).
