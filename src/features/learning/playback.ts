'use client';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { usePreview } from './previewContext';
import type { PlaybackDevice, PlaybackReport, PlaybackResult, Segment } from './types';

/**
 * Video playback reports (docs/api/learning.md → playback). While a video lesson plays, the player keeps the ranges
 * actually played and sends them to `POST /me/lessons/{id}/playback` every ~15 s, on pause/end and when the page is
 * hidden or left. The API merges ranges, counts re-played seconds as rewatches and caps each report by wall-clock
 * time, so the client only reports what it saw. Reports are best effort: a failure is dropped, never shown.
 */

/**
 * Seeks normally arrive as `seeking`/`seeked`; as a safety net, a backwards step or a forward step bigger than this
 * between two `timeupdate`s (~4 per second, fewer when throttled) is treated as an unseen seek (seconds of media time).
 */
const MAX_STEP = 10;
/** The API accepts at most 50 segments per report, each bound within 0..86 400 s. */
const MAX_SEGMENTS = 50;
const MAX_TIME = 86_400;
const FLUSH_MS = 15_000;

const round = (n: number) => Math.round(Math.min(Math.max(n, 0), MAX_TIME) * 10) / 10;

/**
 * Played ranges of one media element. `start` when playback runs, `tick` on `timeupdate`, `stop` on pause/seek/end,
 * `take` to drain what's been played so far (an open range is cut at the playhead and continues).
 */
export class PlayedRanges {
  private from: number | null = null;
  private last = 0;
  private done: Segment[] = [];

  start(t: number): void {
    if (this.from !== null) {
      if (t >= this.last && t - this.last <= MAX_STEP) return; // already open here
      this.close(this.last);
    }
    this.from = t;
    this.last = t;
  }

  tick(t: number): void {
    if (this.from === null) return;
    if (t < this.last || t - this.last > MAX_STEP) {
      // Playhead jumped without seek events: close what was played, continue from here.
      this.close(this.last);
      this.from = t;
    }
    this.last = t;
  }

  /** Closes the open range at `t` when it's a plausible continuation, else at the last seen position. */
  stop(t?: number): void {
    if (this.from === null) return;
    this.close(t !== undefined && t >= this.last && t - this.last <= MAX_STEP ? t : this.last);
  }

  get playing(): boolean {
    return this.from !== null;
  }

  /** Drains the played segments (touching ones joined; overlaps kept — they are rewatches). */
  take(playhead?: number): Segment[] {
    if (this.from !== null) {
      const resume = playhead !== undefined && playhead >= this.last && playhead - this.last <= MAX_STEP ? playhead : this.last;
      this.close(resume);
      this.from = resume;
      this.last = resume;
    }
    const out = joinTouching(this.done);
    this.done = [];
    return out.slice(-MAX_SEGMENTS);
  }

  private close(to: number): void {
    const from = this.from!;
    this.from = null;
    const a = round(from);
    const b = round(to);
    if (b > a) this.done.push([a, b]);
  }
}

/** Joins consecutive segments where one ends exactly where the next starts (pause → play at the same spot). */
export function joinTouching(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const [a, b] of segments) {
    const prev = out.at(-1);
    if (prev && Math.abs(prev[1] - a) < 0.05) prev[1] = Math.max(prev[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** `tablet` for iPads (including iPadOS's desktop UA) and Android tablets, else `web`. */
export function detectDevice(ua: string, maxTouchPoints: number, shortSide: number): PlaybackDevice {
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return 'tablet';
  if (maxTouchPoints > 0 && !/Mobi/i.test(ua) && shortSide >= 600 && shortSide <= 1100) return 'tablet';
  return 'web';
}

function newSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }
}

function currentDevice(): PlaybackDevice {
  try {
    return detectDevice(navigator.userAgent, navigator.maxTouchPoints, Math.min(screen.width, screen.height));
  } catch {
    return 'web';
  }
}

/**
 * Reports what `video` plays for `lessonId` (video lessons only; pass `null` for anything else). One session per
 * player mount and lesson. Third-party embeds (YouTube/Vimeo iframes) can't be read and are never reported — the
 * player only uses its own `<video>` element. `onReported` runs after each accepted report with the API's answer — the
 * lesson's `completion` after the report (the `video` rule is evaluated on every report), or undefined from an older
 * API's `204`. Never reports in the staff preview (`usePreview`): nothing about a preview is recorded.
 */
export function usePlaybackReport(
  video: HTMLVideoElement | null,
  reportLessonId: string | null,
  onReported?: (result: PlaybackResult | undefined) => void,
): void {
  const lessonId = usePreview() ? null : reportLessonId;
  const reported = useRef(onReported);
  useEffect(() => {
    reported.current = onReported;
  });
  useEffect(() => {
    if (!video || !lessonId) return;
    const ranges = new PlayedRanges();
    const session = newSessionId();
    const device = currentDevice();
    const path = `/me/lessons/${encodeURIComponent(lessonId)}/playback`;
    let disabled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const flush = (keepalive = false) => {
      if (disabled) return;
      const segments = ranges.take(ranges.playing ? video.currentTime : undefined);
      if (!segments.length) return;
      const report: PlaybackReport = { session, device, segments };
      api
        .post<PlaybackResult | undefined>(path, report, { keepalive })
        .then((result) => reported.current?.(result))
        .catch((e: unknown) => {
          // The lesson can't be opened (or isn't a video): stop reporting for this mount. Anything else is dropped.
          if (e instanceof ApiError && (e.status === 403 || e.status === 404)) disabled = true;
        });
    };
    const stopTimer = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const onPlaying = () => {
      ranges.start(video.currentTime);
      timer ??= setInterval(() => {
        flush();
      }, FLUSH_MS);
    };
    const onTime = () => {
      ranges.tick(video.currentTime);
    };
    const onSeeking = () => {
      ranges.stop();
    };
    const onSeeked = () => {
      if (!video.paused) ranges.start(video.currentTime);
    };
    const onStop = () => {
      ranges.stop(video.currentTime);
      stopTimer();
      flush();
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush(true);
    };
    const onPageHide = () => {
      flush(true);
    };

    const media: [string, () => void][] = [
      ['playing', onPlaying],
      ['timeupdate', onTime],
      ['seeking', onSeeking],
      ['seeked', onSeeked],
      ['pause', onStop],
      ['ended', onStop],
    ];
    for (const [type, fn] of media) video.addEventListener(type, fn);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      for (const [type, fn] of media) video.removeEventListener(type, fn);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      stopTimer();
      ranges.stop();
      flush(true);
    };
  }, [video, lessonId]);
}
