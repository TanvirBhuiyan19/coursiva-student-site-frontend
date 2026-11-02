/**
 * The mock built-in room's server state (Laravel: live_chat, live_participants, live_polls/votes, live_breakout_rooms
 * and the moderation columns on live_sessions). Kept per tenant object, so `/__mock/reset` (new tenant objects)
 * starts every room afresh. The host's side is the tenant dashboard; e2e drives it through `/__mock/live/…` hooks.
 */
import type { TenantData } from './records';

export interface ChatRow {
  id: string;
  userId: string;
  who: string;
  message: string;
  kind: 'message' | 'announcement' | 'broadcast';
  hiddenAt: string | null;
  createdAt: string;
}

export interface ParticipantRow {
  stage: 'invited' | 'on_stage' | null;
  muted: boolean;
  removed: boolean;
  handRaised: boolean;
  breakoutId: string | null;
  lastChatAt: number | null;
}

export interface PollRow {
  id: string;
  question: string;
  options: string[];
  votes: Map<string, number>;
  status: 'open' | 'closed';
  createdAt: string;
}

export interface RoomState {
  chat: ChatRow[];
  slowSec: number;
  locked: boolean;
  pinnedId: string | null;
  participants: Map<string, ParticipantRow>;
  polls: PollRow[];
  breakouts: { rooms: { id: string; name: string }[]; openedAt: string | null; endsAt: string | null };
}

const rooms = new WeakMap<TenantData, Map<string, RoomState>>();
let seq = 0;
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
export const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36).padStart(4, '0')}`;

function seedRoom(): RoomState {
  const others = ['Priya N.', 'Marcus W.', 'Lena F.'];
  return {
    chat: others.map((who, i) => ({
      id: `lc_seed_${i}`,
      userId: `usr_other_${i}`,
      who,
      message: ['Morning from Lisbon!', 'Slides link please', 'That objection-handling bit was great'][i]!,
      kind: 'message' as const,
      hiddenAt: null,
      createdAt: at(8 - i),
    })),
    slowSec: 0,
    locked: false,
    pinnedId: null,
    participants: new Map(),
    polls: [
      {
        id: 'poll_1',
        question: 'Which topic next?',
        options: ['Pricing', 'Launch emails'],
        votes: new Map([
          ['usr_other_0', 0],
          ['usr_other_1', 0],
          ['usr_other_2', 1],
        ]),
        status: 'open',
        createdAt: at(5),
      },
    ],
    breakouts: { rooms: [], openedAt: null, endsAt: null },
  };
}

export function roomOf(t: TenantData, sessionId: string): RoomState {
  let byId = rooms.get(t);
  if (!byId) {
    byId = new Map<string, RoomState>();
    rooms.set(t, byId);
  }
  let room = byId.get(sessionId);
  if (!room) byId.set(sessionId, (room = seedRoom()));
  return room;
}

export function participant(room: RoomState, userId: string): ParticipantRow {
  let p = room.participants.get(userId);
  if (!p) {
    p = { stage: null, muted: false, removed: false, handRaised: false, breakoutId: null, lastChatAt: null };
    room.participants.set(userId, p);
  }
  return p;
}

export const breakoutOpen = (room: RoomState) =>
  !!room.breakouts.openedAt && !!room.breakouts.endsAt && new Date(room.breakouts.endsAt).getTime() > Date.now();

export const toLearnerChat = (m: ChatRow, userId: string) => ({
  id: m.id,
  who: m.who,
  message: m.message,
  kind: m.kind,
  createdAt: m.createdAt,
  mine: m.userId === userId,
});

export const toLearnerPoll = (p: PollRow, userId: string) => {
  const counts = p.options.map((_, i) => [...p.votes.values()].filter((v) => v === i).length);
  return {
    id: p.id,
    question: p.question,
    options: p.options.map((label, i) => ({ label, votes: counts[i]! })),
    totalVotes: p.votes.size,
    status: p.status,
    myVote: p.votes.get(userId) ?? null,
  };
};
