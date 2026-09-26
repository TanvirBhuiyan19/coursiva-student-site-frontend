/** Profile, notifications, certificates and support. Contract: docs/api/account.md */
import type { Money } from '@/lib/api/types';

export interface Profile {
  name: string;
  email: string;
  bio: string;
  timezone: string;
  website: string;
  initials: string;
  color: string;
  avatarUrl: string | null;
  timezones: { id: string; label: string }[];
  card: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  membership: { planName: string; price: Money; interval: 'month' | 'year'; renewsAt: string } | null;
  preferences: Preferences;
}

export interface Preferences {
  newLessons: boolean;
  communityReplies: boolean;
  liveReminders: boolean;
}

export interface ProfileInput {
  name: string;
  email: string;
  bio: string;
  timezone: string;
  website: string;
}

export interface PasswordInput {
  currentPassword: string;
  password: string;
}

export interface Notification {
  id: string;
  text: string;
  href: string;
  createdAt: string;
  read: boolean;
}

/** Issued by the platform registry, so it outlives the tenant. `verifyUrl` points at verify.coursiva.io. */
export interface Certificate {
  id: string;
  courseTitle: string;
  courseSlug: string;
  learnerName: string;
  instructorName: string;
  issuedAt: string;
  verifyUrl: string;
  linkedInUrl: string;
  pdfUrl: string;
}

export interface HelpCategory {
  title: string;
  articles: { slug: string; title: string }[];
}

export interface LegalDocument {
  slug: 'refund' | 'privacy' | 'terms';
  title: string;
  updatedAt: string;
  sections: { heading: string; body: string }[];
}

export type SupportTopic = 'access' | 'billing' | 'refund' | 'certificate' | 'other';

export interface SupportTicketInput {
  topic: SupportTopic;
  message: string;
  email: string;
}
