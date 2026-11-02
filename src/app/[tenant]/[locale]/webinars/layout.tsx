import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { siteAvailable } from '@/features/tenant/normalize';
import { getCurrentSite } from '@/features/tenant/server';

/** Webinar pages and join links 404 while the platform has live classes switched off (`unavailable` has `live_classes`). */
export default async function WebinarsLayout({ children }: { children: ReactNode }) {
  const site = await getCurrentSite();
  if (!siteAvailable(site, 'live_classes')) notFound();
  return children;
}
