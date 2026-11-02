'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useConsent } from '@/features/consent/useConsent';
import { applyTracking, trackEvent, trackPageView } from './events';
import type { SiteTracking } from './ids';

/** Fired by lead forms after a submission (`features/forms/components/LeadForm.tsx`). */
const LEAD_EVENT = 'coursiva:lead';

/**
 * The school's analytics tags and ad pixels (`GET /site` → `tracking`), loaded once the visitor allows their category
 * (docs/consent.md), plus a page view on every navigation and a lead on every form submission. Nothing loads before
 * the site has set the consent mode, on a declined category, under Global Privacy Control for marketing, or on the
 * staff preview (the layout leaves this out there).
 */
export function TrackingTags({ tracking }: { tracking: SiteTracking }) {
  const consent = useConsent();
  const pathname = usePathname();
  const { ready, analytics, marketing } = consent;

  useEffect(() => {
    if (ready) applyTracking(tracking, { analytics, marketing });
  }, [ready, analytics, marketing, tracking]);

  useEffect(() => {
    if (ready) trackPageView();
  }, [ready, pathname]);

  useEffect(() => {
    const onLead = (e: Event) => {
      const raw = (e as CustomEvent<unknown>).detail;
      const detail = (raw && typeof raw === 'object' ? raw : {}) as { form_id?: unknown; submission_id?: unknown };
      if (typeof detail.submission_id === 'string')
        trackEvent({
          name: 'lead',
          submissionId: detail.submission_id,
          formId: typeof detail.form_id === 'string' ? detail.form_id : undefined,
        });
    };
    window.addEventListener(LEAD_EVENT, onLead);
    return () => window.removeEventListener(LEAD_EVENT, onLead);
  }, []);

  return null;
}
