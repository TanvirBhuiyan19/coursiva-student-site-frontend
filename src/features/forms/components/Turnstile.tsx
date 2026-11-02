'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

/** The bits of Cloudflare's Turnstile API we use (https://developers.cloudflare.com/turnstile/). */
interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
      language?: string;
      action?: string;
    },
  ) => string;
  remove: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let loading: Promise<TurnstileApi> | null = null;

/** Loads Cloudflare's script once, on demand (only forms with Turnstile on ever download it). */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Turnstile did not load.'));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error('Turnstile did not load.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * The anti-spam check. Reports its token (or `null` when it expires or fails); remount it (`key`) for a fresh
 * challenge after the API rejected a token.
 */
export function TurnstileWidget({
  siteKey,
  onToken,
  errorId,
  error,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  errorId: string;
  error?: string;
}) {
  const t = useTranslations('forms');
  const locale = useLocale();
  const box = useRef<HTMLDivElement>(null);
  const report = useRef(onToken);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    report.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let widget: string | null = null;
    let cancelled = false;
    loadTurnstile().then(
      (api) => {
        if (cancelled || !box.current) return;
        widget = api.render(box.current, {
          sitekey: siteKey,
          language: locale.split('-')[0],
          action: 'lead-form',
          callback: (token) => report.current(token),
          'expired-callback': () => report.current(null),
          'error-callback': () => report.current(null),
        });
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      if (widget !== null) window.turnstile?.remove(widget);
    };
  }, [siteKey, locale]);

  return (
    <div className="field">
      <div ref={box} data-testid="turnstile" />
      {failed && <p className="field-hint">{t('turnstileUnavailable')}</p>}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
