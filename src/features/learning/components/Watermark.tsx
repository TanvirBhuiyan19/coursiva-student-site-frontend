'use client';
import { useEffect } from 'react';
import type { VideoWatermark, WatermarkPosition } from '../types';
import { watermarkPosition } from '../video';

const PLACE: Record<WatermarkPosition, Partial<CSSStyleDeclaration>> = {
  'top-left': { top: '6%', left: '4%', right: '', bottom: '', transform: '' },
  'top-right': { top: '6%', right: '4%', left: '', bottom: '', transform: '' },
  center: { top: '50%', left: '50%', right: '', bottom: '', transform: 'translate(-50%, -50%)' },
  'bottom-left': { bottom: '14%', left: '4%', top: '', right: '', transform: '' },
  'bottom-right': { bottom: '14%', right: '4%', top: '', left: '', transform: '' },
};

/**
 * The school's dynamic watermark (docs/storage-and-media.md → Protection): the learner's text over the player, moving
 * through `positions` every `intervalSeconds` from `seed % positions.length`, sized as `fontSizePct`% of the player's
 * height, never catching clicks. It lives inside `container` — the element that goes fullscreen — and is drawn outside
 * React so a MutationObserver can put it back (and restore its style) if someone removes or hides it in devtools.
 *
 * It names the viewer and discourages casual screen recording; DRM is what protects the stream itself.
 */
export function Watermark({ container, spec }: { container: HTMLElement | null; spec: VideoWatermark }) {
  useEffect(() => {
    if (!container) return;
    const el = document.createElement('div');
    el.textContent = spec.text;
    el.setAttribute('aria-hidden', 'true');
    el.dataset.watermark = '';
    let tick = 0;

    const apply = () => {
      const height = container.clientHeight || 360;
      const place = PLACE[watermarkPosition(spec.positions, spec.seed, tick)];
      Object.assign(el.style, {
        position: 'absolute',
        zIndex: '5',
        pointerEvents: 'none',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        fontWeight: '600',
        display: 'block',
        visibility: 'visible',
        color: spec.color,
        opacity: String(spec.opacity),
        fontSize: `${Math.max(10, (height * spec.fontSizePct) / 100)}px`,
        textShadow: '0 1px 2px rgba(0, 0, 0, 0.45)',
      });
      Object.assign(el.style, place);
    };
    apply();
    container.appendChild(el);

    let restoring = false;
    const observer = new MutationObserver(() => {
      if (restoring) return;
      restoring = true;
      if (el.parentNode !== container) container.appendChild(el);
      if (el.textContent !== spec.text) el.textContent = spec.text;
      apply();
      // Our own fixes queue records too: ignore them.
      queueMicrotask(() => {
        observer.takeRecords();
        restoring = false;
      });
    });
    observer.observe(container, { childList: true });
    observer.observe(el, { attributes: true, characterData: true, childList: true, subtree: true });

    const timer = window.setInterval(
      () => {
        tick += 1;
        apply();
      },
      Math.max(1, spec.intervalSeconds) * 1000,
    );
    const resize = new ResizeObserver(apply);
    resize.observe(container);

    return () => {
      observer.disconnect();
      resize.disconnect();
      window.clearInterval(timer);
      el.remove();
    };
  }, [container, spec]);

  return null;
}
