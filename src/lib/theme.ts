import type { Brand } from '@/features/tenant/types';

/**
 * Brand tokens derived from the tenant's hue/chroma pair, exactly as the design derives them. Rendered once on the
 * server into a <style> tag, so the first paint is already on-brand (no flash, no client JS).
 * Neutral tokens don't change per tenant and live in styles/tokens.css. Student surfaces have no dark mode.
 */
export function brandTokens({ hue, chroma }: Brand): Record<string, string> {
  const h = clampHue(hue);
  const c = Math.min(Math.max(chroma, 0), 0.37);
  const f = (n: number) => n.toFixed(3);
  return {
    '--brand': `oklch(0.51 ${f(c * 0.95)} ${h})`,
    '--brand-hover': `oklch(0.46 ${f(c * 0.92)} ${h})`,
    '--brand-link': `oklch(0.48 ${f(c * 0.9)} ${h})`,
    '--brand-tint': `oklch(0.95 0.032 ${h})`,
    '--brand-tint-border': `oklch(0.90 0.05 ${h})`,
    '--brand-soft': `oklch(0.85 0.06 ${h})`,
    '--brand-shadow': `oklch(0.4 0.12 ${h} / 0.13)`,
    '--brand-deep': `oklch(0.29 ${f(Math.min(0.1, c * 0.5))} ${h})`,
    '--brand-deep-text': `oklch(0.85 0.03 ${h})`,
    '--brand-hero-from': `oklch(0.28 0.06 ${h})`,
    '--brand-hero-to': `oklch(0.20 0.04 ${h})`,
  };
}

export function brandCss(brand: Brand): string {
  const body = Object.entries(brandTokens(brand))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  return `:root{${body}}`;
}

/** Theme colour for the browser UI (`<meta name="theme-color">`) — a plain hex-free oklch string is fine there too. */
export const themeColor = (brand: Brand) => brandTokens(brand)['--brand']!;

/**
 * OKLCH → sRGB hex, for places that can't take oklch() (generated OG images/favicons via Satori, e-mail).
 * Out-of-gamut channels are clipped.
 */
export function oklchToHex(l: number, c: number, h: number): string {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  return `#${lin
    .map((x) =>
      Math.round(Math.min(1, Math.max(0, gamma(x))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Brand colours as hex, for Satori-rendered images. */
export function brandHex({ hue, chroma }: Brand) {
  const h = clampHue(hue);
  return {
    brand: oklchToHex(0.51, chroma * 0.95, h),
    deep: oklchToHex(0.29, Math.min(0.1, chroma * 0.5), h),
    tint: oklchToHex(0.95, 0.032, h),
  };
}

function clampHue(h: number) {
  return ((Math.round(h) % 360) + 360) % 360;
}
