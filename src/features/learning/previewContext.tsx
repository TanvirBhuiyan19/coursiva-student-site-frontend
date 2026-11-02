'use client';
import { createContext, useContext, type ReactNode } from 'react';

/**
 * The staff preview (course builder O7, `/preview/{token}`): the real player rendered for a virtual learner. Inside it
 * the player's hooks answer through `/api/v1/preview/{token}/…` and report nothing — no playback, time, progress,
 * notes or questions (`usePlaybackReport`, `useLessonTime` and the block hooks check this). Client-only: never import
 * it from server code.
 */
export interface PreviewState {
  token: string;
}

const PreviewContext = createContext<PreviewState | null>(null);

export function PreviewProvider({ token, children }: { token: string; children: ReactNode }) {
  return <PreviewContext value={{ token }}>{children}</PreviewContext>;
}

/** The preview's token, or null in the learner's own player. */
export function usePreview(): PreviewState | null {
  return useContext(PreviewContext);
}

export const previewKeys = {
  lesson: (token: string, lessonId: string) => ['preview', token, 'lesson', lessonId] as const,
};

/** `/preview/{token}/lessons/{lessonId}…` on the API (relative to `/api/v1`). */
export const previewLessonPath = (token: string, lessonId: string) =>
  `/preview/${encodeURIComponent(token)}/lessons/${encodeURIComponent(lessonId)}`;
