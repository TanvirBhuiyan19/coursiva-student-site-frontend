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
  createdAt: string;
}

export interface NewPostInput {
  spaceId: string;
  body: string;
}
