'use client';
import { useTranslations } from 'next-intl';
import { setPanelOpen } from '@/features/consent/store';
import { useConsent } from '@/features/consent/useConsent';

/** "Cookie settings" (footer): reopens the cookie choices so a visitor can change or withdraw consent at any time. */
export function CookieSettingsButton({ className }: { className?: string }) {
  const t = useTranslations('site');
  const { ready } = useConsent();
  return (
    <button type="button" className={className} disabled={!ready} onClick={() => setPanelOpen(true)}>
      {t('cookieSettings')}
    </button>
  );
}
