// The AI recap next to a live session's replay (Track D; backend docs/engagement.md → AI recaps): `replay.recap` on
// `GET /me/live/{id}` — summary, timestamped chapters and action items — present only once the school published it.

export interface LiveReplayChapter {
  /** Seconds from the start of the recording. */
  startSec: number;
  title: string;
}

export interface LiveReplayRecap {
  summary: string;
  chapters: LiveReplayChapter[];
  actionItems: string[];
}

/** The published recap of a session's replay, if any (tolerates sessions typed without `replay`). */
export function replayRecapOf(session: unknown): LiveReplayRecap | null {
  const replay = (session as { replay?: { status?: string; recap?: LiveReplayRecap | null } | null } | null)?.replay;
  return replay?.status === 'available' && replay.recap ? replay.recap : null;
}

/** Seconds as m:ss, or h:mm:ss from an hour. */
export function clock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Jumps the replay to a chapter: the page's `<video data-live-replay>` when there is one; a `live:seek` event
 * (`detail.seconds`) is always sent too, for players that aren't a plain video element.
 */
export function seekReplay(seconds: number): void {
  if (typeof document === 'undefined') return;
  const video = document.querySelector<HTMLVideoElement>('video[data-live-replay]');
  if (video) {
    video.currentTime = seconds;
    video.play().catch(() => undefined);
  }
  document.dispatchEvent(new CustomEvent('live:seek', { detail: { seconds } }));
}
