import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import {
  apiHeaders,
  baseHeaders,
  EMBED_SOURCE,
  embedHeaders,
  PAGE_SOURCE,
  pageHeaders,
  previewStaticHeaders,
} from './src/lib/securityHeaders';

const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  // Tenants develop on <slug>.localhost (e.g. http://amplify.localhost:3000).
  allowedDevOrigins: ['*.localhost'],
  images: {
    // Uploaded images are rendered straight from the storage bucket / CDN (src/config/image-hosts.ts): this server
    // never fetches, resizes or caches them, so no remote host is allowed here.
    remotePatterns: [],
    formats: ['image/avif', 'image/webp'],
  },
  // Security headers (src/lib/securityHeaders.ts). Pages are never framed (bar the lead-form embed frame); the staff
  // preview's frame-ancestors (the dashboard origin, from env) is set by the proxy.
  headers: () =>
    Promise.resolve([
      { source: '/:path*', headers: baseHeaders },
      { source: PAGE_SOURCE, headers: pageHeaders },
      { source: '/api/:path*', headers: apiHeaders },
      { source: '/sanctum/:path*', headers: apiHeaders },
      { source: '/preview', headers: previewStaticHeaders },
      { source: '/preview/:path*', headers: previewStaticHeaders },
      // The lead-form embed frame: any website may frame it (src/lib/securityHeaders.ts).
      { source: EMBED_SOURCE, headers: embedHeaders },
    ]),
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
