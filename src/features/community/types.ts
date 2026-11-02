/** Community spaces, posts, events and leaderboard. Contract: docs/api/community.md */
import type { Person } from '@/lib/api/types';
import type { LiveEvent } from '@/features/learning/types';

export type SpaceAccess = 'public' | 'members' | 'course' | 'cohort' | 'paid';

export interface Space {
  id: string;
  name: string;
  group: string;
  access: SpaceAccess;
  postCount: number;
  /** Computed per learner by the API: course spaces need an enrolment, paid spaces need the plan. */
  locked: boolean;
  lockedReason: string | null;
  courseSlug: string | null;
}

/** `GET /api/v1/community` */
export interface CommunityOverview {
  name: string;
  memberCount: number;
  onlineCount: number;
  newThisWeek: number;
  guidelines: string;
  spaces: Space[];
  leaderboard: { rank: number; person: Person; points: number; isMe: boolean }[];
  events: LiveEvent[];
}

export interface Post {
  id: string;
  spaceId: string;
  spaceName: string;
  author: Person & { isInstructor: boolean };
  body: string;
  likes: number;
  liked: boolean;
  replies: number;
  /** True when the post waits for a moderator (a link from a new member, or enough reports): it isn't in the feed yet. */
  held?: boolean;
  createdAt: string;
}

/** `GET /api/v1/community/posts/{id}/replies` — oldest first (up to 200). */
export interface Reply {
  id: string;
  author: Person & { isInstructor: boolean };
  body: string;
  createdAt: string;
}

/** Why a member reports a post (`POST /community/posts/{id}/flags { reason }`). */
export const FLAG_REASONS = ['spam', 'harassment', 'off_topic', 'other'] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

export interface NewPostInput {
  spaceId: string;
  body: string;
}
