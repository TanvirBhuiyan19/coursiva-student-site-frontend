import { HideOnPaths } from '@/components/layout/HideOnPaths';
import { ConsentScripts } from '@/components/site/ConsentScripts';
import { HeadCode } from '@/components/site/HeadCode';
import { getCurrentSite } from '@/features/tenant/server';
import { partitionHeadCode } from '@/lib/headCode';
import { CODE_FREE_PREFIXES, EMBED_PREFIXES, PREVIEW_PREFIXES } from '@/lib/routes';

/**
 * The school's custom code on a page that may run it (the layout's `@code` slot decides which, from the path): the
 * passive tags (React hoists them into <head>) and the consent-gated ones (docs/consent.md). `HideOnPaths` still hides
 * it after a client-side navigation to a code-free page (where `CodeFreeReload` reloads if any already ran).
 */
export async function SchoolCode() {
  const site = await getCurrentSite();
  if (!site.headCode) return null;
  const { passive, gated } = partitionHeadCode(site.headCode);
  // A locked site shows only its lock screen: no code runs until the visitor unlocks it.
  const locked = site.siteLock.enabled && !site.siteLock.unlocked;
  return (
    <>
      <HideOnPaths prefixes={CODE_FREE_PREFIXES}>
        <HeadCode elements={passive} />
      </HideOnPaths>
      {gated.length > 0 && !locked && (
        <HideOnPaths prefixes={[...CODE_FREE_PREFIXES, ...PREVIEW_PREFIXES, ...EMBED_PREFIXES]}>
          <ConsentScripts elements={gated} />
        </HideOnPaths>
      )}
    </>
  );
}
