import Image from 'next/image';
import type { CSSProperties, ReactNode } from 'react';
import type { Cover } from '@/lib/api/types';

/** Course artwork: the tenant's uploaded image, or its brand-colour placeholder. */
export function CourseCover({
  cover,
  height,
  sizes = '(max-width: 719px) 100vw, (max-width: 1023px) 50vw, 380px',
  priority = false,
  radius,
  className,
  children,
}: {
  cover: Cover;
  height: number | string;
  sizes?: string;
  priority?: boolean;
  radius?: number;
  className?: string;
  children?: ReactNode;
}) {
  const style: CSSProperties = { position: 'relative', height, background: cover.color, borderRadius: radius, overflow: 'hidden' };
  return (
    <div className={className} style={style}>
      {cover.url && <Image src={cover.url} alt={cover.alt} fill sizes={sizes} priority={priority} style={{ objectFit: 'cover' }} />}
      {children}
    </div>
  );
}
