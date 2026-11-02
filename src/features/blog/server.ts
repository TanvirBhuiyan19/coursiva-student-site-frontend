import 'server-only';
import { cache } from 'react';
import { apiGetOrNull, apiGetPage, cacheTags } from '@/lib/api/server';
import type { BlogPost, BlogPostCard } from './types';

/** Scheduled posts go live by the clock (no webhook), so blog reads also expire every 5 minutes. */
const BLOG_REVALIDATE = 300;

/** The newest published posts (one page of 50). */
export const getBlogPosts = cache(
  async (tenant: string): Promise<BlogPostCard[]> =>
    (await apiGetPage<BlogPostCard>(tenant, '/blog/posts?per_page=50', { tags: [cacheTags.blog(tenant)], revalidate: BLOG_REVALIDATE }))
      .data,
);

export const getBlogPost = cache((tenant: string, slug: string) =>
  /^[a-z0-9-]{1,80}$/.test(slug)
    ? apiGetOrNull<BlogPost>(tenant, `/blog/posts/${slug}`, { tags: [cacheTags.blog(tenant)], revalidate: BLOG_REVALIDATE })
    : Promise.resolve(null),
);
