'use client';
import { useEffect } from 'react';
import { useAppPathname } from '@/i18n/navigation';
import { isCodeFreePath } from '@/lib/routes';
import { ranSchoolCode } from './ConsentScripts';

/**
 * The school's custom code never runs on sign-in, password, token, checkout and account pages (`CODE_FREE_PREFIXES`),
 * but code added on an earlier page keeps running across client-side navigations. Arriving on such a page after any
 * ran reloads it as a fresh document, where none is added (docs/consent.md).
 */
export function CodeFreeReload() {
  const pathname = useAppPathname();
  useEffect(() => {
    if (ranSchoolCode() && isCodeFreePath(pathname)) window.location.reload();
  }, [pathname]);
  return null;
}
