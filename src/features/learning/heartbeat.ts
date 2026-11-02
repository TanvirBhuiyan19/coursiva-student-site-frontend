'use client';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { usePreview } from './previewContext';
import type { LessonTimeBeat } from './types';

/**
 * Time on a lesson for the `time` completion rule (docs/api/learning.md → completion rules). While the lesson page is
 * visible and the window has focus, the player counts seconds and sends them to `POST /me/lessons/{id}/time
 * { seconds }` every 15 s (at most 60 per beat — the API's bound), and once more with `fetch` keepalive when the page is
 * hidden or left. The API adds them up (capped, throttled 6/min) and completes the lesson when the rule is met.
 */

export const BEAT_MS = 15_000;
/** The API accepts 1–60 seconds per beat. */
export const MAX_BEAT_SECONDS = 60;
/** Beats closer together than this wait for the next tick (hiding and showing a tab must not flood the API). */
const MIN_GAP_MS = 10_000;

/** Counts visible milliseconds; `take` drains them as whole seconds (the remainder carries over). */
export class VisibleClock {
  private since: number | null = null;
  private carried = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  set(visible: boolean): void {
    const n = this.now();
    if (visible && this.since === null) this.since = n;
    else if (!visible && this.since !== null) {
      this.carried += n - this.since;
      this.since = null;
    }
  }

  take(): number {
    const n = this.now();
    let ms = this.carried;
    if (this.since !== null) {
      ms += n - this.since;
      this.since = n;
    }
    const seconds = Math.floor(ms / 1000);
    // Anything over the per-beat cap is dropped, not banked: a beat never claims more than it can prove.
    this.carried = seconds >= MAX_BEAT_SECONDS ? 0 : ms - seconds * 1000;
    return Math.min(seconds, MAX_BEAT_SECONDS);
  }
}

const pageVisible = () => document.visibilityState === 'visible' && document.hasFocus();

/**
 * Sends time beats for `lessonId` (pass null to send none — lessons without the time rule, or done ones). `onBeat`
 * receives each answer. A `403`/`404`/`422` stops the beats for this mount; other failures are dropped. Never in the staff
 * preview (`usePreview`): nothing about a preview is recorded.
 */
export function useLessonTime(beatLessonId: string | null, onBeat: (beat: LessonTimeBeat) => void): void {
  const lessonId = usePreview() ? null : beatLessonId;
  const callback = useRef(onBeat);
  useEffect(() => {
    callback.current = onBeat;
  });

  useEffect(() => {
    if (!lessonId) return;
    const clock = new VisibleClock();
    const path = `/me/lessons/${encodeURIComponent(lessonId)}/time`;
    let stopped = false;
    let last = 0;

    /** `keepalive` lets the beat outlive the page; `force` skips the gap (the page is going away). */
    const send = (keepalive = false, force = false) => {
      if (stopped) return;
      if (!force && Date.now() - last < MIN_GAP_MS) return;
      const seconds = clock.take();
      if (seconds < 1) return;
      last = Date.now();
      api
        .post<LessonTimeBeat>(path, { seconds }, { keepalive })
        .then((beat) => callback.current(beat))
        .catch((e: unknown) => {
          if (e instanceof ApiError && (e.status === 403 || e.status === 404 || e.status === 422)) stopped = true;
        });
    };
    const onChange = () => {
      clock.set(pageVisible());
      if (document.visibilityState === 'hidden') send(true);
    };
    const onPageHide = () => {
      clock.set(false);
      send(true, true);
    };

    clock.set(pageVisible());
    const timer = setInterval(() => send(), BEAT_MS);
    document.addEventListener('visibilitychange', onChange);
    window.addEventListener('focus', onChange);
    window.addEventListener('blur', onChange);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onChange);
      window.removeEventListener('focus', onChange);
      window.removeEventListener('blur', onChange);
      window.removeEventListener('pagehide', onPageHide);
      clock.set(false);
      send(true, true);
      stopped = true;
    };
  }, [lessonId]);
}
