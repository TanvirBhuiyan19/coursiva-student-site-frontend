'use client';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Renders (server-rendered) children except on the given path prefixes — e.g. no site footer in the course player. */
export function HideOnPaths({ prefixes, children }: { prefixes: string[]; children: ReactNode }) {
  const pathname = usePathname();
  return prefixes.some((p) => pathname.startsWith(p)) ? null : children;
}
