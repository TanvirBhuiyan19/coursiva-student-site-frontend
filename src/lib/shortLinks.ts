/**
 * SMS short links: a broadcast's links go out as `{site}/l/{code}` (8–12 base62 characters). The proxy forwards them to
 * the API's `GET /api/v1/l/{code}`, which counts the click and redirects to the destination (docs/api/README.md).
 */
const SHORT_LINK = /^\/l\/([0-9A-Za-z]{8,12})$/;

/** The API path a short link is served from, or null when `pathname` isn't one. */
export function shortLinkApiPath(pathname: string): string | null {
  const code = SHORT_LINK.exec(pathname)?.[1];
  return code ? `/api/v1/l/${code}` : null;
}
