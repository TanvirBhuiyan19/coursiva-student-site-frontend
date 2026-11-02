'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { countdown } from '../timing';

/** The current time, re-read every `everyMs` (client only; pauses nothing — cheap). */
export function useNow(everyMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/**
 * "Starts in 2 d 4 h" / "Starts in 12 min" / "Starts in 0:42" (the last minute ticks in seconds). `aria-live` is
 * off: a ticking timer must not flood screen readers; the session's date and time are on the page as text.
 */
export function Countdown({ target, now }: { target: number; now: number }) {
  const t = useTranslations('liveSchedule.countdown');
  const c = countdown(target, now);
  const text =
    c.d > 0
      ? t('days', { d: c.d, h: c.h })
      : c.h > 0
        ? t('hours', { h: c.h, m: c.m })
        : c.m > 0
          ? t('minutes', { m: c.m + (c.s > 0 ? 1 : 0) })
          : t('seconds', { s: c.s });
  return (
    <span data-testid="live-countdown" aria-live="off">
      {text}
    </span>
  );
}
