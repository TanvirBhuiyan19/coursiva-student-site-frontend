/**
 * Uploaded images (course covers, product thumbnails, logos, site images) live in the platform's storage: the
 * console's Public assets bucket (R2 / S3 / CDN) in production, the API's public disk only when no bucket is
 * connected. They are always rendered straight from that address — never proxied, resized or cached by this server
 * (`/_next/image` would fetch each one and keep a copy on local disk, which the platform rule forbids once a bucket is
 * connected). next.config.ts therefore allows no remote image hosts at all; only the app's own bundled images
 * (relative paths) go through the optimiser. Plain module (no `server-only`): components and tests import it.
 */

/** Whether `next/image` may optimise an image: only the app's own assets (`/…`), never an uploaded (absolute) URL. */
export const isOptimizableImage = (url: string): boolean => url.startsWith('/') && !url.startsWith('//');
