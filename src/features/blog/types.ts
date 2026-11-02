/** The school's blog on its storefront. Contract: docs/api/pages.md → Blog. */

/** `GET /api/v1/blog/posts` rows (paginated) — published posts, newest first. */
export interface BlogPostCard {
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string | null;
  categories: string[];
  author: { name: string };
  readMinutes: number;
  hasCover: boolean;
}

export interface BlogComment {
  id: string;
  authorName: string;
  text: string;
  createdAt: string;
}

/** `GET /api/v1/blog/posts/{slug}` — `body` is Markdown. */
export interface BlogPost extends BlogPostCard {
  body: string;
  seo: { title: string; description: string };
  /** The call to action under the post (`none`, `course`, `newsletter`, …): the site shows a newsletter box or the catalogue link. */
  cta: string;
  /** Approved comments, oldest first. */
  comments: BlogComment[];
}

/** `POST /api/v1/blog/posts/{slug}/comments` → `202` (held for moderation). */
export interface BlogCommentInput {
  name: string;
  email: string;
  text: string;
}
