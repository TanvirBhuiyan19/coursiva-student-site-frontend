/** CDN caching for tenant assets (sitemap, robots, icons, share images): fresh for an hour, served stale while refreshing. */
export const CDN_CACHE = 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400';
