import Image from 'next/image';
import type { CSSProperties, ReactNode } from 'react';
import { isOptimizableImage } from '@/config/image-hosts';
import type { Cover } from '@/lib/api/types';

/**
 * Course artwork: the tenant's uploaded image, or a branded placeholder built from the course colour (a soft
 * diagonal gradient with a highlight, so empty covers still read as designed artwork rather than flat blocks).
 */
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
  const style: CSSProperties = {
    position: 'relative',
    height,
    borderRadius: radius,
    overflow: 'hidden',
    backgroundColor: cover.color,
    backgroundImage: cover.url
      ? undefined
      : `radial-gradient(120% 90% at 100% 0%, oklch(1 0 0 / 0.22), transparent 55%), radial-gradient(90% 70% at 0% 100%, oklch(0 0 0 / 0.18), transparent 60%), linear-gradient(135deg, ${cover.color}, color-mix(in oklch, ${cover.color}, black 18%))`,
  };
  return (
    <div className={className} style={style}>
      {cover.url && (
        <Image
          src={cover.url}
          alt={cover.alt}
          fill
          sizes={sizes}
          priority={priority}
          style={{ objectFit: 'cover' }}
          unoptimized={!isOptimizableImage(cover.url)}
        />
      )}
      {children}
    </div>
  );
}
