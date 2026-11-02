/** Pure helpers for the lesson video: the Shaka DRM config and the watermark's moving position. Unit-tested. */
import type { VideoDrm, WatermarkPosition } from './types';

export interface ShakaDrmConfig {
  servers: Record<string, string>;
  advanced?: Record<string, { serverCertificateUri: string }>;
}

/**
 * Mux DRM licence URLs → Shaka's `drm` config (docs/storage-and-media.md): Widevine, FairPlay (with its certificate)
 * and PlayReady key systems. Null when the stream isn't encrypted.
 */
export function shakaDrmConfig(drm: VideoDrm | null): ShakaDrmConfig | null {
  if (!drm) return null;
  const servers: Record<string, string> = {};
  if (drm.widevineLicenseUrl) servers['com.widevine.alpha'] = drm.widevineLicenseUrl;
  if (drm.playreadyLicenseUrl) servers['com.microsoft.playready'] = drm.playreadyLicenseUrl;
  if (drm.fairplayLicenseUrl) servers['com.apple.fps'] = drm.fairplayLicenseUrl;
  if (Object.keys(servers).length === 0) return null;
  return drm.fairplayLicenseUrl && drm.fairplayCertificateUrl
    ? { servers, advanced: { 'com.apple.fps': { serverCertificateUri: drm.fairplayCertificateUrl } } }
    : { servers };
}

/** The watermark's position after `tick` moves: it starts at `seed % positions.length` and steps through the list. */
export function watermarkPosition(positions: WatermarkPosition[], seed: number, tick: number): WatermarkPosition {
  if (positions.length === 0) return 'center';
  const n = positions.length;
  return positions[(((seed + tick) % n) + n) % n] ?? 'center';
}
