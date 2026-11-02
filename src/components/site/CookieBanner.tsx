'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { saveChoice, setPanelOpen, type ConsentCategory } from '@/features/consent/store';
import { useConsent } from '@/features/consent/useConsent';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';
import styles from './Site.module.css';

/**
 * Cookie consent (docs/consent.md). With the school's cookie banner on (Settings → Privacy, `GET /site` →
 * `cookie_banner`), the notice asks first and nothing non-essential runs until the visitor accepts a category;
 * "Decline" keeps everything off. "Cookie settings" in the footer reopens the choices at any time, banner on or off.
 * Essential cookies (session, security, cart, unlocks) always work. Global Privacy Control keeps marketing off.
 */
export function CookieBanner() {
  const t = useTranslations('site');
  const consent = useConsent();
  const [customising, setCustomising] = useState(false);
  const askFirst = consent.ready && consent.required && !consent.decided;
  const open = consent.ready && (askFirst || consent.panelOpen);
  if (!open) return null;
  const detailed = customising || consent.panelOpen;
  const decide = (analytics: boolean, marketing: boolean) => {
    setCustomising(false);
    saveChoice({ analytics, marketing });
  };
  return (
    <section className={styles.cookie} aria-label={t('cookieLabel')}>
      {detailed ? (
        <CookieChoices
          key={`${String(consent.analytics)}-${String(consent.marketing)}`}
          initial={{ analytics: consent.analytics, marketing: consent.marketing }}
          gpc={consent.gpc}
          focusOnOpen={consent.panelOpen}
          onSave={(c) => decide(c.analytics, c.marketing)}
          onDeclineAll={() => decide(false, false)}
          onClose={consent.decided || !consent.required ? () => setPanelOpen(false) : null}
        />
      ) : (
        <>
          <p>
            {t('cookieText')} <Link href={routes.privacy}>{t('cookiePolicy')}</Link>
          </p>
          <div className={styles.cookieActions}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setCustomising(true)}>
              {t('cookieCustomise')}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => decide(false, false)}>
              {t('cookieDecline')}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => decide(true, !consent.gpc)}>
              {t('cookieAccept')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function CookieChoices({
  initial,
  gpc,
  focusOnOpen,
  onSave,
  onDeclineAll,
  onClose,
}: {
  initial: Record<ConsentCategory, boolean>;
  gpc: boolean;
  focusOnOpen: boolean;
  onSave: (choice: Record<ConsentCategory, boolean>) => void;
  onDeclineAll: () => void;
  onClose: (() => void) | null;
}) {
  const t = useTranslations('site');
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [choice, setChoice] = useState(initial);
  useEffect(() => {
    // Opened from the footer link: move focus into the panel so keyboard and screen-reader users land on it.
    if (focusOnOpen) heading.current?.focus();
  }, [focusOnOpen]);
  const row = (category: ConsentCategory, disabled: boolean, note?: string) => (
    <li className={styles.cookieRow}>
      <label className="check">
        <input
          type="checkbox"
          checked={category === 'marketing' && gpc ? false : choice[category]}
          disabled={disabled}
          aria-describedby={`${id}-${category}`}
          onChange={(e) => setChoice((c) => ({ ...c, [category]: e.target.checked }))}
        />
        <span>
          <strong>{t(`cookieCategory.${category}`)}</strong>
          <span id={`${id}-${category}`} className={styles.cookieHint}>
            {note ?? t(`cookieCategoryHint.${category}`)}
          </span>
        </span>
      </label>
    </li>
  );
  return (
    <div className={styles.cookieChoices}>
      <h2 ref={heading} tabIndex={-1} className={styles.cookieTitle}>
        {t('cookieSettings')}
      </h2>
      <ul className={styles.cookieRows}>
        <li className={styles.cookieRow}>
          <label className="check">
            <input type="checkbox" checked disabled aria-describedby={`${id}-essential`} />
            <span>
              <strong>{t('cookieCategory.essential')}</strong>
              <span id={`${id}-essential`} className={styles.cookieHint}>
                {t('cookieCategoryHint.essential')}
              </span>
            </span>
          </label>
        </li>
        {row('analytics', false)}
        {row('marketing', gpc, gpc ? t('cookieGpc') : undefined)}
      </ul>
      <div className={styles.cookieActions}>
        {onClose && (
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
            {t('cookieClose')}
          </button>
        )}
        <button type="button" className="btn btn-outline btn-sm" onClick={onDeclineAll}>
          {t('cookieDecline')}
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onSave({ ...choice, marketing: choice.marketing && !gpc })}>
          {t('cookieSave')}
        </button>
      </div>
    </div>
  );
}
