/** A learner's live class. Contract: docs/api/community.md → Live sessions. */
import type { LiveEvent, VideoBlock } from '@/features/learning/types';
import type { LiveReplayRecap } from './recap';

/** `GET /api/v1/me/live/{id}` — the `LiveEvent` plus what the session page and the built-in room need. `404` when the
 * learner can't see it (not enrolled in its course, no access to its space). */
export interface LiveSession extends LiveEvent {
  durationMin: number;
  status: 'scheduled' | 'live' | 'ended';
  course: { slug: string; title: string } | null;
  /** Open polls while a built-in room is live (empty otherwise). */
  polls: LivePoll[];
  /** The scheduled end (`starts_at` + `duration_min`). */
  endsAt: string;
  /** When the way in opens: 15 minutes before the start (the host can open it earlier by starting). */
  joinOpensAt: string;
  /** On the waitlist (full session): no way in until a seat frees up. */
  waitlisted: boolean;
  /** The community space it was posted to, if any. */
  space: { id: string; name: string } | null;
  /** Once ended: the replay (null before). */
  replay: LiveReplay | null;
  /** "Add to Google Calendar" / "Add to Outlook" links (the session's real length, its page as location). */
  calendar?: { google: string; outlook: string };
}

/**
 * A finished session's recording on `/live/{id}`: `available` (signed playback, the course media rules) for its
 * registrants and the course's learners; `restricted` for anyone else who can see the session; `processing` until the
 * school publishes it; `none` when nothing was recorded.
 */
export interface LiveReplay {
  status: 'available' | 'processing' | 'restricted' | 'none';
  video: VideoBlock | null;
  /** The AI recap (Track D), once the school publishes one. */
  recap?: LiveReplayRecap | null;
}

export type LiveScope = 'upcoming' | 'going' | 'recordings';

/** One row of `GET /api/v1/me/live` (the learner's schedule). */
export interface LiveScheduleItem extends LiveEvent {
  endsAt: string;
  durationMin: number;
  joinOpensAt: string;
  status: 'scheduled' | 'live' | 'ended';
  waitlisted: boolean;
  course: { slug: string; title: string } | null;
  space: { id: string; name: string } | null;
  /** Ended with a published recording (the `recordings` scope). */
  hasReplay: boolean;
}

/** `GET /api/v1/me/live?scope=&limit=&cursor=` */
export interface LiveSchedulePage {
  sessions: LiveScheduleItem[];
  nextCursor: string | null;
  /** The learner's own time zone (profile), else null: the browser's. */
  timezone: string | null;
}

/** `GET /api/v1/me/live/calendar` — the calendar feed (the link itself is only shown when it is made). */
export interface CalendarFeedStatus {
  active: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
}

/** `POST /api/v1/me/live/calendar` — a new subscribe link (any previous one stops working). */
export interface CalendarFeedLink extends CalendarFeedStatus {
  url: string;
  webcalUrl: string;
  googleUrl: string;
  outlookUrl: string;
}

/** `POST /api/v1/me/live/{id}/token` — a short-lived Daily meeting token for the built-in room's video (never stored). */
export interface RoomToken {
  roomUrl: string;
  token: string;
  expiresAt: string;
  isOwner: boolean;
  canRecord: boolean;
}

export interface LivePoll {
  id: string;
  question: string;
  options: string[];
}

/** A chat message in the room as a learner sees it (hidden messages are never sent). */
export interface RoomChatMessage {
  id: string;
  who: string;
  message: string;
  kind: 'message' | 'announcement' | 'broadcast';
  createdAt: string;
  mine: boolean;
}

/** A poll with live results; `myVote` is the learner's answer (a vote is final). */
export interface RoomPoll {
  id: string;
  question: string;
  options: { label: string; votes: number }[];
  totalVotes: number;
  status: 'open' | 'closed';
  myVote: number | null;
}

/** `GET /api/v1/me/live/{id}/room` — the room's state for this learner, polled every few seconds while live. `403
 * { reason: 'removed' }` once the host removed them. */
export interface RoomFeed {
  status: 'scheduled' | 'live' | 'ended';
  me: {
    handRaised: boolean;
    stage: 'invited' | 'on_stage' | null;
    muted: boolean;
    breakout: { id: string; name: string; endsAt: string } | null;
  };
  moderation: { slowModeSec: number; chatLocked: boolean };
  pinned: RoomChatMessage | null;
  /** The latest messages, oldest first; `chatCursor` loads older ones. */
  chat: RoomChatMessage[];
  chatCursor: string | null;
  polls: RoomPoll[];
}

/** `GET /api/v1/me/live/{id}/chat?before={id}` — older messages, oldest first. */
export interface RoomChatPage {
  messages: RoomChatMessage[];
  nextCursor: string | null;
}
