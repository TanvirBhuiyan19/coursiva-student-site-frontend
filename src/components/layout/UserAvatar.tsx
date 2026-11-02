import type { User } from '@/features/auth/types';

/** Initials from the name when the API sent none (older `/me` payloads). */
export const initialsOf = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '?') + (words.length > 1 ? (words.at(-1)?.[0] ?? '') : '')).toUpperCase();
};

/**
 * The learner's avatar from `/me`: their photo (`avatar_url`) or initials on their colour. Rendered inside the
 * caller's `.avatar` element; the photo is decorative (the link around it carries the label).
 */
export function UserAvatar({ user }: { user: Pick<User, 'name' | 'initials' | 'avatarUrl'> }) {
  if (user.avatarUrl)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a small avatar from the API's storage host; next/image would need every host configured
      <img
        src={user.avatarUrl}
        alt=""
        width={36}
        height={36}
        style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
      />
    );
  return <>{user.initials || initialsOf(user.name)}</>;
}

/** The avatar's background: the learner's colour, else the school's brand. */
export const avatarBackground = (user: Pick<User, 'color' | 'avatarUrl'>) =>
  user.avatarUrl ? 'transparent' : user.color || 'var(--brand)';
