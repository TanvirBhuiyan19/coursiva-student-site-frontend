'use client';
import { useLocale } from 'next-intl';
import { createContext, use, type ReactNode } from 'react';
import { formatSchoolDateTime } from './format';

/**
 * The school's time zone (`site.timeZone`, IANA) for client components — set once by the tenant layout. Null (no
 * provider, or an API without `time_zone`) means "format in the viewer's zone".
 */
const SchoolTimeZoneContext = createContext<string | null>(null);

export function SchoolTimeZone({ value, children }: { value: string | null; children: ReactNode }) {
  return <SchoolTimeZoneContext value={value}>{children}</SchoolTimeZoneContext>;
}

export const useSchoolTimeZone = () => use(SchoolTimeZoneContext);

/**
 * Formats an instant in the school's time zone (lesson unlocks, live sessions); the viewer's when the site has none.
 * Client components only — `useFormat` stays server-safe, so it doesn't read this context.
 */
export function useSchoolDateTime() {
  const locale = useLocale();
  const tz = useSchoolTimeZone();
  return (iso: string) => formatSchoolDateTime(iso, locale, tz);
}
