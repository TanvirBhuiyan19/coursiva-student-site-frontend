import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

/**
 * Security headers for every response. A nonce-based CSP would force every page to render dynamically (no ISR), so
 * the policy here locks down framing, plugins, base URIs and form targets without a script-src; add one with hashes
 * if/when a third-party script policy is agreed.
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self)' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'" },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  // Tenants develop on <slug>.localhost (e.g. http://amplify.localhost:3000).
  allowedDevOrigins: ['*.localhost'],
  images: {
    // Tenant uploads are served from the platform CDN.
    remotePatterns: [{ protocol: 'https', hostname: 'cdn.coursiva.app' }],
    formats: ['image/avif', 'image/webp'],
  },
  headers: () => Promise.resolve([{ source: '/:path*', headers: securityHeaders }]),
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
