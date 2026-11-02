import { SchoolCode } from '@/components/site/SchoolCode';
import { isCodeFreePath } from '@/lib/routes';

/**
 * The school's custom code for one path (the layout's `@code` slot): the passive tags (React hoists them into <head>)
 * and the consent-gated ones (docs/consent.md). Decided on the server from the path itself, so sign-in, password,
 * token, checkout and account pages (`CODE_FREE_PREFIXES`) get none of it — the code is not even in their payload. The
 * path is part of the page's cache key, so this keeps every page as cacheable as before. `HideOnPaths` and
 * `CodeFreeReload` still cover client-side navigations: code that already ran on an earlier page.
 */
export function generateStaticParams() {
  return [];
}

/** The locale-less app path of the slot's segments, decoded (`null` for a malformed escape: no code then). */
function pathOf(segments: string[]): string | null {
  try {
    return `/${segments.map((s) => decodeURIComponent(s)).join('/')}`;
  } catch {
    return null;
  }
}

/** The code of every page but the home page (`@code/page.tsx`), the same segments as the pages' `[...slug]`. */
export default async function SchoolCodeFor({ params }: PageProps<'/[tenant]/[locale]/[...slug]'>) {
  const path = pathOf((await params).slug);
  if (path === null || isCodeFreePath(path)) return null;
  return <SchoolCode />;
}
