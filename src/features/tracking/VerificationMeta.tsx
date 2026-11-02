import { VERIFICATION_META, type SiteTracking } from './ids';

/**
 * The school's site-verification tags (Search Console, Bing, Yandex, Pinterest), rendered on the server in <head>.
 * They run nothing and set nothing, so they need no consent (docs/consent.md). The tokens are validated (`ids.ts`).
 */
export function VerificationMeta({ tracking }: { tracking: SiteTracking }) {
  return (Object.keys(VERIFICATION_META) as (keyof SiteTracking['verification'])[]).map((key) => {
    const content = tracking.verification[key];
    return content ? <meta key={key} name={VERIFICATION_META[key]} content={content} /> : null;
  });
}
