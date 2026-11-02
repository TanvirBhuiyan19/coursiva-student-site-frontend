import type { CSSProperties } from 'react';
import type { Person } from '@/lib/api/types';

/**
 * An instructor's photo (`avatarUrl`, an absolute public image URL rendered straight from storage) or their initials
 * on their placeholder colour. Decorative: the name next to it (or the link around it) carries the meaning.
 */
export function InstructorAvatar({
  person,
  size,
  fontSize,
  className,
  style,
  priority = false,
}: {
  person: Pick<Person, 'name' | 'initials' | 'color' | 'avatarUrl'>;
  size: number;
  fontSize: number;
  className?: string;
  style?: CSSProperties;
  /** Above the fold (the profile hero): load at once. */
  priority?: boolean;
}) {
  return (
    <span
      className={className ? `avatar ${className}` : 'avatar'}
      style={{ width: size, height: size, fontSize, background: person.avatarUrl ? 'transparent' : person.color, ...style }}
      aria-hidden="true"
    >
      {person.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- uploaded images are served straight from storage, never via /_next/image (config/image-hosts.ts)
        <img
          src={person.avatarUrl}
          alt=""
          width={size}
          height={size}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
        />
      ) : (
        person.initials
      )}
    </span>
  );
}
