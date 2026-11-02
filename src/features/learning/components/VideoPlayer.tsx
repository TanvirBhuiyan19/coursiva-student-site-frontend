'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useFormat } from '@/lib/useFormat';
import { usePlaybackReport } from '../playback';
import type { PlaybackResult, VideoBlock } from '../types';
import { shakaDrmConfig } from '../video';
import styles from './Player.module.css';
import { Watermark } from './Watermark';

type Source = { kind: 'hls'; url: string } | { kind: 'file'; url: string } | { kind: 'embed'; url: string } | null;

/** What to play: signed Mux HLS once transcoded, else the signed source file, else a third-party embed. */
export function videoSource(v: VideoBlock): Source {
  if (v.hlsUrl) return { kind: 'hls', url: v.hlsUrl };
  if (v.url) return { kind: 'file', url: v.url };
  if (v.embedUrl) return { kind: 'embed', url: v.embedUrl };
  return null;
}

/**
 * Lesson video.
 *
 * - **HLS** (`hlsUrl`, signed Mux URLs) plays with Shaka Player, imported on demand so its bundle never lands on pages
 *   without video. With `video.drm`, the Mux licence URLs become Shaka's DRM config (Widevine / PlayReady / FairPlay +
 *   its certificate). Browsers Shaka doesn't support fall back to native HLS (Safari).
 * - The **source file** (`url`) is the fallback while there is no HLS; an **embed** (`embedUrl`) plays in an iframe.
 * - **Captions** (`captions[]`) render as `<track>`s — a WCAG 2.2 requirement.
 * - The school's **watermark** (`video.watermark`) is drawn over the player and goes fullscreen with it: the container,
 *   not the `<video>`, is what goes fullscreen (the native fullscreen button is hidden, and a `<video>` fullscreen is
 *   moved to the container), and picture-in-picture is off.
 *
 * What the learner actually plays is reported for the school's video analytics (`usePlaybackReport`) when
 * `reportLessonId` is set — video lessons in the player only; embeds expose no playhead, and the course page's guest
 * preview (`reportLessonId: null`) never reports. Unmounting pauses the video and drops its source, so closing a
 * preview or leaving a lesson stops playback and downloading at once. The mock API has no media, so it renders the
 * poster and a notice.
 */
export function VideoPlayer({
  video,
  title,
  durationSeconds,
  reportLessonId,
  completed,
  autoStart = false,
  className,
  onReported,
}: {
  video: VideoBlock;
  /** The lesson's title: names the play button and the embed frame. */
  title: string;
  durationSeconds: number | null;
  /** The lesson whose playback is reported, or null for no reports (guest previews). */
  reportLessonId: string | null;
  /** The learner's completion, shown as the watch bar under the poster; omit for no bar (previews). */
  completed?: boolean;
  /** Start right away instead of showing the play button (the viewer already asked to watch). */
  autoStart?: boolean;
  className?: string;
  /** After each accepted playback report, with its answer (the `video` completion rule's progress). */
  onReported?: (result: PlaybackResult | undefined) => void;
}) {
  const t = useTranslations('player');
  const f = useFormat();
  const [started, setStarted] = useState(autoStart);
  const [mediaEl, setMediaEl] = useState<HTMLVideoElement | null>(null);
  // The same element for imperative use (Shaka, native HLS fallback); `mediaEl` state drives the playback report.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const source = videoSource(video);
  const wm = video.watermark;
  usePlaybackReport(mediaEl, source?.kind !== 'embed' ? reportLessonId : null, onReported);

  // Unmounted (preview closed, lesson left): stop playback and release the stream, not just detach the element.
  useEffect(() => {
    if (!mediaEl) return;
    return () => {
      mediaEl.pause();
      mediaEl.removeAttribute('src');
      mediaEl.load();
    };
  }, [mediaEl]);

  // HLS: attach Shaka (lazy) with the DRM config; native HLS when Shaka can't run here.
  useEffect(() => {
    const el = videoRef.current;
    if (!mediaEl || !el || source?.kind !== 'hls') return;
    const run = { destroyed: false, destroy: null as (() => Promise<void>) | null };
    void (async () => {
      try {
        const shaka = (await import('shaka-player/dist/shaka-player.hls.js')).default;
        if (run.destroyed) return;
        shaka.polyfill.installAll();
        if (!shaka.Player.isBrowserSupported()) {
          if (el.canPlayType('application/vnd.apple.mpegurl')) el.src = source.url;
          else setFailed(true);
          return;
        }
        const player = new shaka.Player();
        run.destroy = () => player.destroy();
        await player.attach(el);
        const drm = shakaDrmConfig(video.drm);
        if (drm) player.configure({ drm });
        await player.load(source.url);
      } catch {
        if (!run.destroyed) setFailed(true);
      }
    })();
    return () => {
      run.destroyed = true;
      void run.destroy?.();
    };
  }, [mediaEl, source?.kind, source?.url, video.drm]);

  // Keep the watermark on screen in fullscreen: a fullscreen <video> is moved to the container.
  useEffect(() => {
    if (!box) return;
    const onChange = () => {
      const el = document.fullscreenElement;
      setFullscreen(el === box);
      if (wm && el && el === mediaEl) {
        void document
          .exitFullscreen()
          .then(() => box.requestFullscreen())
          .catch(() => undefined);
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [box, mediaEl, wm]);

  const toggleFullscreen = () => {
    if (!box) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void box.requestFullscreen().catch(() => undefined);
  };

  const playing = started && source !== null && !failed;
  return (
    <div
      className={className ? `${styles.video} ${className}` : styles.video}
      ref={setBox}
      data-fullscreen={fullscreen || undefined}
      // The signed Mux poster (a frame of the video) behind the play button.
      style={
        !playing && video.posterUrl ? { backgroundImage: `url(${JSON.stringify(video.posterUrl)})`, backgroundSize: 'cover' } : undefined
      }
    >
      {playing && source.kind === 'embed' ? (
        <iframe
          className={styles.videoEl}
          src={source.url}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen={!wm}
        />
      ) : playing ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- <track>s are rendered from video.captions below
        <video
          ref={(node) => {
            videoRef.current = node;
            setMediaEl(node);
          }}
          className={styles.videoEl}
          controls
          autoPlay
          playsInline
          poster={video.posterUrl ?? undefined}
          src={source.kind === 'file' ? source.url : undefined}
          controlsList={wm ? 'nofullscreen nodownload' : 'nodownload'}
          disablePictureInPicture={!!wm}
          crossOrigin="anonymous"
        >
          {video.captions.map((c) => (
            <track key={c.lang} kind="captions" srcLang={c.lang} label={c.label} src={c.url} />
          ))}
        </video>
      ) : (
        <button type="button" className={styles.playBtn} onClick={() => setStarted(true)} aria-label={t('play', { title })}>
          <span aria-hidden="true">▶</span>
        </button>
      )}
      {started && (source === null || failed) && (
        <p className={styles.noMedia} role="status">
          {failed ? t('mediaFailed') : t('noMedia')}
        </p>
      )}
      {wm && <Watermark container={box} spec={wm} />}
      {wm && playing && source.kind !== 'embed' && (
        <button type="button" className={styles.fullscreenBtn} onClick={toggleFullscreen} aria-pressed={fullscreen}>
          {fullscreen ? t('exitFullscreen') : t('fullscreen')}
        </button>
      )}
      {!playing && (
        <>
          {completed !== undefined && (
            <span className={styles.watch} aria-hidden="true">
              <span style={{ width: completed ? '100%' : '32%' }} />
            </span>
          )}
          {durationSeconds !== null && <span className={styles.duration}>{f.clock(durationSeconds)}</span>}
        </>
      )}
    </div>
  );
}
