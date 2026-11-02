import Image from 'next/image';
import { isOptimizableImage } from '@/config/image-hosts';
import type { Site } from '@/features/tenant/types';

/** The tenant's logo, or its initial on a brand-coloured tile. Decorative: the adjacent name labels it. */
export function BrandMark({ site, size }: { site: Pick<Site, 'name' | 'logoUrl'>; size: number }) {
  if (site.logoUrl)
    return (
      <Image
        src={site.logoUrl}
        alt=""
        width={size}
        height={size}
        unoptimized={!isOptimizableImage(site.logoUrl)}
        style={{ borderRadius: size * 0.3 }}
      />
    );
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: 'var(--brand)',
        color: 'var(--on-accent)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: size * 0.47,
        flexShrink: 0,
      }}
    >
      {site.name.charAt(0).toUpperCase()}
    </span>
  );
}
