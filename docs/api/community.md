# Community

`404` on every endpoint when the tenant's plan lacks community.

| Endpoint                                                                                                      | Auth    | Result                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/community`                                                                                       | —       | `CommunityOverview { name, member_count, online_count, guidelines, spaces[], leaderboard[], events[] }`                                                                                                                                                                                                                                                         |
| `GET /api/v1/community/posts?space=&sort=new\|top&page=`                                                      | —       | paginated `Post[]`; `403` (with the reason) for a locked space                                                                                                                                                                                                                                                                                                  |
| `POST /api/v1/community/posts`                                                                                | learner | `{ space_id, body ≤ 5000 }` → `201 Post`; `403` locked, `422`                                                                                                                                                                                                                                                                                                   |
| `PUT/DELETE /api/v1/community/posts/{id}/like`                                                                | learner | `Post` (idempotent)                                                                                                                                                                                                                                                                                                                                             |
| `GET /api/v1/community/posts/{id}/replies`                                                                    | —       | `Reply[] { id, author { …Person, is_instructor }, body, created_at }` oldest first (≤ 200); `404` held/unknown post, `403` locked space                                                                                                                                                                                                                         |
| `POST /api/v1/community/posts/{id}/replies`                                                                   | learner | `{ body: 2..5000 }` → `201 Post` (its new `replies` count); `403` locked / muted, `422 body`                                                                                                                                                                                                                                                                    |
| `POST /api/v1/community/posts/{id}/flags`                                                                     | learner | `{ reason?: spam\|harassment\|off_topic\|other }` → `202 { flagged: true }`; `422 reason`. See below                                                                                                                                                                                                                                                            |
| `PUT/DELETE /api/v1/community/events/{id}/rsvp`                                                               | learner | `LiveEvent`                                                                                                                                                                                                                                                                                                                                                     |
| `GET /api/v1/me/live/{id}`                                                                                    | learner | `LiveSession` = `LiveEvent` + `{ duration_min, status: scheduled\|live\|ended, course { slug, title } \| null, polls[], ends_at, join_opens_at, waitlisted, space { id, name } \| null, replay: LiveReplay \| null, calendar { google, outlook } }` (see Live session pages); `404` when not visible                                                            |
| `POST /api/v1/me/live/{id}/presence`, `…/questions`, `…/chat`, `…/hands` (+ `DELETE`), `…/polls/{poll}/votes` | learner | `204`; `409` unless the built-in room is live; `403` without an RSVP; `403 reason: removed` once removed. Chat: `409 reason: chat_locked`, `403 reason: muted`, `429 reason: slow_mode` + `retry_after`; questions `403 reason: muted`; a second vote `409` “You already voted in this poll.”                                                                   |
| `POST /api/v1/me/live/{id}/token`                                                                             | learner | `RoomToken { room_url, token, expires_at, is_owner: false, can_record: false }` (video); see below                                                                                                                                                                                                                                                              |
| `GET /api/v1/me/live/{id}/room`                                                                               | learner | `RoomFeed { status, me { hand_raised, stage: null\|invited\|on_stage, muted, breakout { id, name, ends_at } \| null }, moderation { slow_mode_sec, chat_locked }, pinned: RoomChatMessage \| null, chat: RoomChatMessage[] (latest 50, oldest first), chat_cursor, polls: RoomPoll[] (newest 5) }`; polled every 4 s while live; never includes hidden messages |
| `GET /api/v1/me/live/{id}/chat?before={id}`                                                                   | learner | `{ messages: RoomChatMessage[] (≤ 50, oldest first), next_cursor }`; never hidden messages                                                                                                                                                                                                                                                                      |
| `POST /api/v1/me/live/{id}/stage/accept`, `…/stage/leave`                                                     | learner | `204`; accept `409` “The host hasn’t invited you to the stage.”                                                                                                                                                                                                                                                                                                 |
| `POST /api/v1/me/live/{id}/breakout/token`                                                                    | learner | `RoomToken` for the learner's breakout room; `409` “You aren’t in a breakout room.”                                                                                                                                                                                                                                                                             |

- **Space access is computed per learner by the API** (`locked`, `locked_reason`): `course` spaces need an
  enrolment, `paid` spaces need the top plan, `cohort` spaces need cohort membership. `sp_all` ("All posts")
  aggregates the spaces the learner can read.
- **Held posts**: `POST /community/posts` answers `Post` with `held: true` when the post waits for a moderator (a link
  from a member with fewer than 3 published posts). It is not in the feed until approved, so the site says "Awaiting
  approval: a moderator reviews your post before it appears in {space}." instead of "Posted".
- **Replies** open under each post ("N replies" / "Reply", `aria-expanded`); guests read them and get "Sign in to reply".
- **Reports** ("Report" on each post, signed in): a modal asks for the reason. A member's report counts once; reports
  on one's own post are ignored. 3 reports from different members hold a published post for review with
  `held_reason` "Flagged by 3 members (spam)" (the reason most reporters gave; `off_topic` reads "off topic").
- `LiveEvent.provider` is `zoom | google_meet | teams | built_in`; `join_url` is the learner's personal join link
  (BYO provider via the tenant's OAuth connection) or the in-browser room, `null` for guests.

## Live schedule (`/live`)

Additions for the learner's live classes page, the learning dashboard's "Upcoming live classes" widget and the
personal calendar feed. Same visibility as `GET /me/live/{id}`: sessions of the learner's enrolled courses and of
community spaces they can read.

| Endpoint                                                                    | Auth    | Result                                                                                                                                                                          |
| --------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/me/live?scope=upcoming\|going\|recordings&limit=1..50&cursor=` | learner | `{ sessions: LiveScheduleItem[], next_cursor, timezone }`; `422` bad scope, limit or cursor                                                                                     |
| `GET /api/v1/me/live/calendar`                                              | learner | `{ active, created_at, last_used_at }` (never the link)                                                                                                                         |
| `POST /api/v1/me/live/calendar`                                             | learner | `201 { active, created_at, last_used_at, url, webcal_url, google_url, outlook_url }`: a new link, shown once; any previous link stops working (10 per 10 min)                   |
| `DELETE /api/v1/me/live/calendar`                                           | learner | `204`: the link stops working                                                                                                                                                   |
| `GET /api/v1/live/calendar/{token}.ics`                                     | token   | `text/calendar` feed of the learner's RSVP'd sessions; `404` for an unknown, replaced or revoked token or an inactive account; `429` past 20/min per link or 60/min per address |

- **Scopes**: `upcoming` (default) is live now or still to come: not ended, and started or within its slot plus an
  hour, soonest first. `going` is those the learner RSVP'd to (registered or waitlisted). `recordings` is ended
  sessions with a published recording the learner may watch (a registrant or a learner of its course), newest first.
  `limit` defaults to 20; `next_cursor` is opaque.
- `LiveScheduleItem` = `LiveEvent` + `{ ends_at, duration_min, join_opens_at, status: scheduled|live|ended, waitlisted,
course { slug, title } | null, space { id, name } | null, has_replay }`. `join_opens_at` is 15 minutes before the
  start. `timezone` is the learner's profile zone, or `null`: then the page uses the browser's.
- **The calendar feed** is a secret URL: `lcal_` + 48 random letters and digits, stored only as a SHA-256 hash, so
  the page shows it once, right after it is made. It lists the sessions the learner is registered for (not
  waitlisted) from 30 days back, each with its real length, a stable `UID` (`live-{id}@{host}`) and the session page
  as URL. It holds no join tokens, no other attendees and no personal data. Calendar apps refresh it about hourly. "Get
  a new link" replaces the old link; "Turn off" deletes it. Google subscribes through `?cid=webcal://…`, Apple opens
  `webcal://` and Outlook uses `addfromweb`.

The page (`/live`, signed in) has filters for Upcoming, This week (the next 7 days, client side), My RSVPs and Replays.
Rows are grouped by day in the learner's zone ("Times in British Summer Time · Change"). Each row has a status
(Live now, Starting soon inside the join window, a countdown within a day, Didn't take place), RSVP or Can't make
it, and the way in once the join window opens. A side panel holds the calendar subscription. The header (a calendar
icon), the mobile drawer ("Live classes") and the learning dashboard (the next 3 sessions + "See all") link to it.

## Live session pages

`/live/{id}` (invite, reminder and recap e-mails) shows when (in the learner's zone, with a countdown and "Joining
opens at …"), RSVP (or the waitlist), add-to-calendar (a `.ics` with the session's real length, plus the `calendar.google` /
`calendar.outlook` "add" links) and the way in. The
Join button turns on 15 minutes before the start (`join_opens_at`) or as soon as the host starts. Once the session
ends it shows `replay` (no dead end for the recap e-mail's link):

- `LiveReplay { status: available|processing|restricted|none, video: VideoView | null, recap? }`. `available` plays
  the published recording right there, through the course media rules (signed short-lived URLs, Mux HLS/DRM, captions,
  the school's watermark). It is for registrants and learners of the session's course; anyone else who can see the
  session gets `restricted` without media. `processing` means recorded but not yet published; `none` means not
  recorded (or the file is gone). `recap` is the AI recap (Track D).
- The page re-reads the session every 20 seconds, so it goes live, the join opens and the replay appears on their own.

Before the replay, `/live/{id}` shows the way in: the
provider's join link for Zoom / Meet / Teams, or `/live/{id}/room` for the built-in room. The room sends a presence
heartbeat a minute (attendance) and reads the room's state every 4 seconds (`GET /me/live/{id}/room`): the chat
(latest 50 + "Load earlier"), the pinned message or announcement, polls with live results, the learner's hand, stage
invite, mute and breakout room. Everything the host does in the dashboard booth is server state, so it reaches the
learner on the next read:

- **Hidden / deleted messages** are never returned (feed or history) and vanish from the page: from the live feed on
  the next read, and from earlier pages the learner loaded within 30 seconds (the last 5 loaded pages are re-read
  while shown, each from the cursor it was loaded with). Older chat (`GET …/chat?before=`) has its own rate-limit
  bucket (60/min per learner), apart from the room's 120/min; meeting tokens are 20/min.
- **Slow mode / lock / mute** are enforced on `POST …/chat` (the page shows the server's message, a countdown from
  `retry_after`, and disables the box while locked or muted).
- **Polls**: one vote per learner (final); results show after voting and when the poll closes.
- **Stage**: an invite shows "Join the stage" / "Not now"; accepting rejoins the video with a fresh token that can send
  camera and microphone (audience tokens can't). "Leave the stage" steps down.
- **Breakout rooms**: while the learner is assigned and the rooms are open, the video switches to their room
  (`…/breakout/token`) and shows the host's broadcasts; it returns to the main room when the rooms close.
- **Removed**: every room call answers `403 reason: removed`; the page stops the video and says so.

`RoomChatMessage { id, who, message, kind: message|announcement|broadcast, created_at, mine }` ·
`RoomPoll { id, question, options: [{ label, votes }], total_votes, status: open|closed, my_vote: int|null }`.

### Built-in room video (Daily)

The room embeds Daily Prebuilt (`@daily-co/daily-js`, `DailyIframe.createFrame({ url: room_url, token })`) beside the
panels. `POST /api/v1/me/live/{id}/token` returns a short-lived meeting token (about 30 minutes; it only has to be
valid when joining, so the room asks again to rejoin) for a private room named after the school and session:

- `403` without an RSVP; `403 { code: 'extension_required', extension: 'rooms' }` when the school lost the extension;
- `409` for a session in Zoom / Meet / Teams, before the room opens (`reason: 'room_not_open'`: 15 minutes before
  the start, unless the host already started) and after the session ended (or, never started, its scheduled end plus
  an hour);
- `409 { code: 'feature_unavailable', reason: 'video_not_configured' }` when the platform hasn't connected Daily;
- `503` when Daily is unavailable (try again).

Tokens are never stored. Attendance also comes from Daily's join/leave events (webhooks), deduplicated with the
heartbeat. Headers (`next.config.ts`): `Permissions-Policy` delegates camera, microphone and display-capture to
`https://*.daily.co` only; the site's CSP restricts no frame or connect sources, so Daily's frame and call servers need
no entry (if a `frame-src` / `connect-src` is ever added, include `https://*.daily.co` and `wss://*.daily.co
wss://*.wss.daily.co`). daily-js is bundled (lazy-loaded on the room page), so no script host. The mock API returns `room_url: https://mock.daily.co/{room}` and the e2e tests replace
Daily with a test double (`window.__DAILY_TEST_DOUBLE__`), so no network or key is needed.

### AI recap on the replay

Once a session ended and its replay is `available`, `GET /api/v1/me/live/{id}` → `replay.recap` is the AI recap the
school published: `{ summary, chapters: [{ start_sec, title }], action_items: string[] }`, else `null` (schools review
AI recaps before learners see them). `LiveReplayRecap` (`src/features/live/components/LiveReplayRecap.tsx`) shows it
beside the replay; a chapter seeks `<video data-live-replay>` and sends a `live:seek` event (`detail.seconds`).

## Paid sessions and webinars (Track F)

A session can be **free** (the default), **paid** (a ticket, sold through the normal checkout) or **members** (only
members of the memberships or buyers of the products the school included). Course learners always get in free.

- `LiveEvent.ticket` (also on `LiveSession` and every `LiveScheduleItem`) is `null` for free sessions, else
  `LiveTicketOffer { access: paid|members, price: Money|null, series_price: Money|null, has_access, sold_out }`.
  `has_access`: a seat without buying (course learner, included membership or product, or a ticket already bought).
  `series_price`: one ticket for every upcoming session of its series. Prices are the API's; the site only formats.
- `PUT /community/events/{id}/rsvp` without access answers `402 payment_required` with `reason: ticket_required`
  (paid) or `members_only`. `DELETE …/rsvp` of a bought seat answers `409 reason: ticket_bought` (the school refunds
  tickets; a refund gives the seat up).
- `/live/{id}` shows `LiveTicketCta` instead of RSVP when `ticket.has_access` is false: "Buy ticket — $X" →
  `/checkout?live={id}` (and "Buy the series — $Y" → `&series=1`), "See memberships" for members-only sessions, or
  "Sold out". Schedule rows link to the session page ("Get a ticket" / "Members only").
- Checkout target: `{ kind: 'live', live_session_id, series? }` (commerce.md). The order's item is
  `kind: 'live'` ("Live class ticket"); the thank-you page links to `/live`. Paying registers the learner (the
  confirmation email carries the calendar invite).

### Public webinars (`/webinars/{slug}`)

| Endpoint                                     | Auth | Result                                                                                                                                                                                                                                                                                          |
| -------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/webinars/{slug}`                | —    | `PublicWebinar { id, slug, title, description, starts_at, duration_min, status, time_zone, course { title, slug\|null } \| null, access, price, seats_left, sold_out, registration_open, form { token, turnstile_site_key, min_fill_seconds }, calendar { google, outlook } }`; `404`; no-store |
| `POST /api/v1/webinars/{slug}/registrations` | —    | `{ name, email, token, website, turnstile_token? }` → `WebinarRegistration { next: check_email\|checkout\|membership, status: registered\|waitlisted\|null, checkout_url_path?, membership_url_path? }`; `422` name/email/token/turnstile_token; `409` ended; `429`                             |
| `POST /api/v1/webinars/join`                 | —    | `{ t }` → `{ session_id, signed_in }`; `401 reason: sign_in_required` (+ `session_id`), `403 reason: join_link_not_yours`, `410` invalid or cancelled                                                                                                                                           |

- **SEO**: the page is server-rendered and indexable (canonical + hreflang, Open Graph, JSON-LD `Event` with an
  `OnlineEventAttendanceMode`, `VirtualLocation` and the ticket `Offer`; members-only sessions carry no offer). An ended
  webinar stays reachable but is `noindex`. The server copy is cached 60 s (tag `t:{tenant}:webinar:{slug}`, no
  webhook needed); seats and the form token are re-read in the browser.
- **Bot protection** as the school's public forms: the signed form token from the page, the `website` honeypot
  (off-screen, `aria-hidden`, not focusable), a 3-second minimum fill time and Cloudflare Turnstile when the school
  saved its keys. The button disables while the request is in flight (and the API answers a double submit from the
  first one). A `token` error re-reads the page for a fresh token.
- **Visitors** register with a name and an email (every visitor becomes a lead). Free: "Check your inbox" (the email
  has the calendar invite and the personal join link). Paid: on to `/checkout?live={id}` (sign in or create the
  account there: the platform has no guest checkout). Members-only: on to `/membership`.
- **Signed-in learners** act on their own account: "You're registered" + the session page, RSVP a free seat, or the
  ticket CTA.
- **The join link** `/webinars/join?t=` (noindex): a guest account (made by the registration, no password chosen yet)
  is signed in and lands on `/live/{id}`; an account with a password signs in first (`/sign-in?next=/live/{id}`);
  someone else's link and dead links say so. Mock: `wjt_demo_guest` signs the demo learner in to "Email copy clinic".
