'use client';
import { useAppPathname } from '@/i18n/navigation';
import { underPrefix } from '@/lib/routes';
import type { ReactNode } from 'react';

/**
 * Renders (server-rendered) children except on the given path prefixes — e.g. no site footer in the course player.
 * Prefixes are segment-aware: `/account` covers `/account` and `/account/x`, not `/accounting`.
 */
export function HideOnPaths({ prefixes, children }: { prefixes: readonly string[]; children: ReactNode }) {
  const pathname = useAppPathname();
  return prefixes.some((p) => underPrefix(pathname, p)) ? null : children;
}
