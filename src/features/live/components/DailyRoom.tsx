'use client';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api/errors';
import type { RoomToken } from '../types';
import styles from './Live.module.css';

/** The slice of daily-js's call object the room uses (so a test double can stand in for it). */
export interface DailyFrame {
  join(options: { url: string; token: string }): Promise<unknown>;
  on(event: string, handler: (event?: { errorMsg?: string; error?: { type?: string } }) => void): unknown;
  destroy(): Promise<void>;
  iframe(): HTMLIFrameElement | null;
}

export interface DailyFactory {
  createFrame(parent: HTMLElement, options: Record<string, unknown>): DailyFrame;
  supportedBrowser?(): { supported: boolean };
}

declare global {
  interface Window {
    /** e2e: replaces Daily (which needs network and a key) with a local double. */
    __DAILY_TEST_DOUBLE__?: DailyFactory;
  }
}

/** daily-js is only fetched on the room page (it isn't small), unless a test double is installed. */
async function loadDaily(): Promise<DailyFactory> {
  if (typeof window !== 'undefined' && window.__DAILY_TEST_DOUBLE__) return window.__DAILY_TEST_DOUBLE__;
  const mod = await import('@daily-co/daily-js');
  return mod.default as unknown as DailyFactory;
}

type State = 'connecting' | 'prejoin' | 'joined' | 'left' | 'error' | 'unavailable' | 'notOpen' | 'unsupported';

/**
 * The built-in room's video: Daily Prebuilt in a frame, joined with a fresh meeting token each time (`getToken`). Daily
 * draws its own controls (camera, microphone, screen share, leave); blocked devices still let the learner watch.
 */
export function DailyRoom({ title, getToken }: { title: string; getToken: () => Promise<RoomToken> }) {
  const t = useTranslations('live.video');
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<DailyFrame | null>(null);
  const failed = useRef(false);
  const [state, setState] = useState<State>('connecting');
  const [devicesBlocked, setDevicesBlocked] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setDevicesBlocked(false);
    setState('connecting');
    failed.current = false;
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    // An object, so the async steps below see the cleanup's change.
    const run = { cancelled: false };
    const active = () => !run.cancelled;
    const start = async () => {
      let session: RoomToken;
      let Daily: DailyFactory;
      try {
        [session, Daily] = await Promise.all([getToken(), loadDaily()]);
      } catch (err) {
        if (!active()) return;
        if (err instanceof ApiError && err.status === 409 && err.reason === 'video_not_configured') setState('unavailable');
        else if (err instanceof ApiError && err.status === 409 && err.reason === 'room_not_open') setState('notOpen');
        else if (err instanceof ApiError && (err.status === 403 || err.status === 409)) setState('unavailable');
        else setState('error');
        return;
      }
      if (!active() || !box.current) return;
      if (Daily.supportedBrowser && !Daily.supportedBrowser().supported) {
        setState('unsupported');
        return;
      }
      const call = Daily.createFrame(box.current, {
        iframeStyle: { width: '100%', height: '100%', border: '0', borderRadius: '12px' },
        showLeaveButton: true,
        showFullscreenButton: true,
      });
      frame.current = call;
      setState('prejoin');
      call.iframe()?.setAttribute('title', t('frameTitle', { title }));
      call.on('joined-meeting', () => active() && setState('joined'));
      // Daily follows a fatal error with left-meeting: keep the error on screen, not "you left".
      call.on('left-meeting', () => active() && !failed.current && setState('left'));
      call.on('camera-error', () => active() && setDevicesBlocked(true));
      call.on('error', (e?: { errorMsg?: string }) => {
        if (!active()) return;
        failed.current = true;
        setState(e?.errorMsg?.startsWith('account-') ? 'unavailable' : 'error');
      });
      try {
        await call.join({ url: session.roomUrl, token: session.token });
      } catch {
        if (active()) setState('error');
      }
    };
    void start();
    return () => {
      run.cancelled = true;
      const call = frame.current;
      frame.current = null;
      void call?.destroy().catch(() => undefined);
    };
  }, [attempt, getToken, t, title]);

  const message =
    state === 'connecting'
      ? t('connecting')
      : state === 'left'
        ? t('left')
        : state === 'error'
          ? t('error')
          : state === 'unavailable'
            ? t('unavailable')
            : state === 'notOpen'
              ? t('notOpen')
              : state === 'unsupported'
                ? t('unsupported')
                : null;
  const showFrame = state === 'connecting' || state === 'prejoin' || state === 'joined';
  return (
    <section className={styles.video} aria-label={t('title')}>
      <div ref={box} className={styles.videoFrame} hidden={!showFrame} data-testid="daily-frame" />
      {message && (
        <div className={styles.videoNote} role={state === 'error' ? 'alert' : 'status'}>
          <p>{message}</p>
          {(state === 'left' || state === 'error' || state === 'notOpen') && (
            <button type="button" className="btn btn-primary" onClick={retry}>
              {state === 'left' ? t('rejoin') : t('retry')}
            </button>
          )}
        </div>
      )}
      {devicesBlocked && state === 'joined' && (
        <p className={styles.meta} role="status">
          {t('devices')}
        </p>
      )}
    </section>
  );
}
