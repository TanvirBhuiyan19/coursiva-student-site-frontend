/** Learner accounts (Laravel Sanctum SPA auth). Contract: docs/api/auth.md */

/** `GET /api/v1/me` → 200 with the signed-in learner, or 401 for guests. */
export interface User {
  id: string;
  name: string;
  email: string;
  initials: string;
  avatarUrl: string | null;
  color: string;
  bio: string;
  timezone: string;
  website: string;
  /** Plan id when the learner has an active membership. */
  membershipPlanId: string | null;
  streakDays: number;
  cartCount: number;
  wishlistCount: number;
  unreadNotifications: number;
}

export interface LoginInput {
  email: string;
  password: string;
  remember: boolean;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  /** The group invite link's token (`/join/{token}`): the new account claims a seat in that group. */
  group?: string;
}

/** `POST /api/v1/auth/reset-password` — also how an invited learner sets a first password. */
export interface ResetPasswordInput {
  email: string;
  token: string;
  password: string;
  passwordConfirmation: string;
}

export interface ForgotPasswordInput {
  email: string;
}
