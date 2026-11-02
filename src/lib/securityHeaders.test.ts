import { modifyRouteRegex } from 'next/dist/lib/redirect-status';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';
import { isPreviewPath, parseOrigins, previewHeaders } from './securityHeaders';

type Header = { key: string; value: string };

/**
 * The headers next.config sends for a path, matched the way Next's router does (server/lib/router-utils/filesystem.js:
 * strict, with an optional trailing slash); later rules win per key.
 */
async function headersFor(path: string): Promise<Record<string, string>> {
  const rules = (await nextConfig.headers!()) as { source: string; headers: Header[] }[];
  const out: Record<string, string> = {};
  for (const rule of rules) {
    if (!getPathMatch(rule.source, { strict: true, regexModifier: (r) => modifyRouteRegex(r) })(path)) continue;
    for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

describe('framing and referrer headers', () => {
  it('never lets anyone frame a page', async () => {
    for (const path of [
      '/',
      '/courses',
      '/courses/launch-lab',
      '/learn/launch-lab/les_1',
      '/es/courses',
      '/previewer',
      '/blog/preview',
      // Only the embed frame itself is framable: not the hosted form page, other embed paths or a prefixed frame.
      '/forms/frm_abc',
      '/embed',
      '/embed/forms',
      '/embed/forms/frm_abc/extra',
      '/embed/formsx/frm_abc',
      '/es/embed/forms/frm_abc',
      '/x/embed/forms/frm_abc',
    ]) {
      const h = await headersFor(path);
      expect(h['Content-Security-Policy'], path).toMatch(/^frame-ancestors 'none'; /);
      expect(h['X-Frame-Options'], path).toBe('DENY');
      expect(h['Referrer-Policy'], path).toBe('strict-origin-when-cross-origin');
      expect(h['Strict-Transport-Security'], path).toBeDefined();
    }
  });

  it('keeps same-origin framing for API content (SCORM packages play in the player’s iframe)', async () => {
    const h = await headersFor('/api/v1/files/scorm/abc/index.html');
    expect(h['Content-Security-Policy']).toMatch(/^frame-ancestors 'self'; /);
    expect(h['X-Frame-Options']).toBeUndefined();
  });

  it('leaves the staff preview’s framing to the proxy (dashboard origin), with no referrer and noindex', async () => {
    for (const path of ['/preview/pv_abc', '/preview']) {
      const h = await headersFor(path);
      expect(h['Content-Security-Policy'], path).toBeUndefined();
      expect(h['X-Frame-Options'], path).toBeUndefined();
      expect(h['Referrer-Policy'], path).toBe('no-referrer');
      expect(h['X-Robots-Tag'], path).toBe('noindex, nofollow');
      expect(h['X-Content-Type-Options'], path).toBe('nosniff');
    }
    expect(previewHeaders(['https://app.example.com'])).toEqual(
      expect.arrayContaining([
        {
          key: 'Content-Security-Policy',
          value: "frame-ancestors https://app.example.com; base-uri 'self'; object-src 'none'; form-action 'self'",
        },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      ]),
    );
    // No dashboard configured: not framable at all.
    expect(previewHeaders([]).find((h) => h.key === 'Content-Security-Policy')?.value).toMatch(/^frame-ancestors 'none'; /);
    expect(isPreviewPath('/preview/x')).toBe(true);
    expect(isPreviewPath('/previews')).toBe(false);
  });

  it('lets any website frame the lead-form embed frame, noindex, and nothing else', async () => {
    for (const path of ['/embed/forms/frm_abc', '/embed/forms/frm_abc/']) {
      const h = await headersFor(path);
      expect(h['Content-Security-Policy'], path).toBe("frame-ancestors *; base-uri 'self'; object-src 'none'; form-action 'self'");
      expect(h['X-Frame-Options'], path).toBeUndefined();
      expect(h['X-Robots-Tag'], path).toBe('noindex, nofollow');
      expect(h['Referrer-Policy'], path).toBe('strict-origin-when-cross-origin');
      expect(h['X-Content-Type-Options'], path).toBe('nosniff');
    }
  });

  it('accepts only bare origins for DASHBOARD_ORIGIN', () => {
    expect(parseOrigins('http://app.localhost:5174 https://app.example.com/')).toEqual([
      'http://app.localhost:5174',
      'https://app.example.com',
    ]);
    expect(parseOrigins('https://a.example.com,https://b.example.com')).toEqual(['https://a.example.com', 'https://b.example.com']);
    expect(parseOrigins('')).toEqual([]);
    expect(parseOrigins('https://app.example.com/path')).toBeNull();
    expect(parseOrigins("https://app.example.com; script-src 'unsafe-inline'")).toBeNull();
    expect(parseOrigins('javascript:alert(1)')).toBeNull();
    expect(parseOrigins('*')).toBeNull();
  });
});
