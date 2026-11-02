'use client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Video } from '../types';
import styles from './Sections.module.css';

/** Adds autoplay to a provider embed address, so one press starts the video once the player loads. */
export function autoplayUrl(embedUrl: string): string {
  const url = new URL(embedUrl);
  url.searchParams.set('autoplay', '1');
  return url.toString();
}

/**
 * A school video. Nothing loads from the provider until the visitor presses play (no third-party request, cookie or
 * tracker on page load), then the player is an iframe of the API-built `embedUrl` only — never a raw URL — with a
 * strict referrer policy, lazy loading and a sandbox. Media library videos play in a native <video>.
 */
export function VideoEmbed({
  video,
  title,
  caption = '',
  wide = false,
}: {
  video: Video;
  title: string;
  caption?: string;
  wide?: boolean;
}) {
  const t = useTranslations('pages');
  const [playing, setPlaying] = useState(false);
  const cls = `${styles.video} ${wide ? styles.videoWide : ''}`;

  if (playing && video.provider === 'media') {
    return (
      <figure className={cls}>
        {/* The school's own upload: no caption track is available from the Media library yet. */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video className={styles.videoFrame} src={video.url} controls autoPlay playsInline preload="metadata" aria-label={title} />
      </figure>
    );
  }
  if (playing && video.embedUrl) {
    return (
      <figure className={cls}>
        <iframe
          className={styles.videoFrame}
          src={autoplayUrl(video.embedUrl)}
          title={title}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
        />
      </figure>
    );
  }
  return (
    <figure className={cls}>
      <button type="button" className={styles.playBtn} onClick={() => setPlaying(true)} aria-label={t('play', { title })}>
        <span className={styles.play} aria-hidden="true">
          ▶
        </span>
      </button>
      {caption !== '' && (
        <figcaption className={styles.videoCap} aria-hidden="true">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
