'use client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useFormat } from '@/lib/useFormat';
import type { Lesson } from '../types';
import styles from './Player.module.css';

/**
 * Lesson video. Production streams come from the platform pipeline as HLS with CENC encryption and multi-DRM
 * (Widevine/FairPlay) — play them with Shaka Player, loaded on demand (`import('shaka-player')`) so the player's ~300 KB
 * never lands on pages without video. Captions (`lesson.video.captions`) render as <track>s, a WCAG 2.2 requirement.
 *
 * The mock API has no media, so `hlsUrl` is null and this renders the design's poster with a play affordance.
 */
export function VideoPlayer({ lesson }: { lesson: Lesson }) {
  const t = useTranslations('player');
  const f = useFormat();
  const [started, setStarted] = useState(false);
  const video = lesson.video!;

  return (
    <div className={styles.video}>
      {video.hlsUrl && started ? (
        // Real playback path: Shaka attaches to this element (see component doc).
        // eslint-disable-next-line jsx-a11y/media-has-caption -- <track>s are rendered from lesson.video.captions below
        <video className={styles.videoEl} controls autoPlay playsInline poster={video.posterUrl ?? undefined}>
          {video.captions.map((c) => (
            <track key={c.lang} kind="captions" srcLang={c.lang} label={c.label} src={c.url} />
          ))}
        </video>
      ) : (
        <button type="button" className={styles.playBtn} onClick={() => setStarted(true)} aria-label={t('play', { title: lesson.title })}>
          <span aria-hidden="true">▶</span>
        </button>
      )}
      {started && !video.hlsUrl && (
        <p className={styles.noMedia} role="status">
          {t('noMedia')}
        </p>
      )}
      <span className={styles.watch} aria-hidden="true">
        <span style={{ width: lesson.completed ? '100%' : '32%' }} />
      </span>
      {lesson.durationSeconds !== null && <span className={styles.duration}>{f.clock(lesson.durationSeconds)}</span>}
    </div>
  );
}
