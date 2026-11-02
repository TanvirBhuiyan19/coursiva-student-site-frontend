# Instructor profiles (public, cached)

Pages: `/instructors` (index) and `/instructors/{slug}` (profile). Both are public, crawlable and cached like the
catalogue. Same tenant resolution, site lock and caching rules as `GET /courses` ([catalog.md](catalog.md)); nothing
here needs a session. A profile exists on the site only while the school published it **and** its member is an active
team member whose role can teach (Owner, Admin, Instructor, Teacher) — anything else is a plain `404`.

Not in v1: a reviews list on the profile, co-instructors, site-builder instructor blocks.

## Types

```ts
interface InstructorStats {
  learnerCount: number; // distinct learners with a live (active/completed) enrolment in the instructor's catalogue courses
  courseCount: number; // the instructor's published, public courses (the ones listed below)
  rating: number | null; // mean of every review of those courses, 1 decimal; null without reviews
  reviewCount: number;
}

interface InstructorSocialLink {
  platform: 'linkedin' | 'x' | 'youtube' | 'instagram' | 'facebook' | 'tiktok' | 'github';
  url: string; // https:// on the platform's own domain (checked by the API)
}

interface InstructorCredential {
  title: string;
  issuer: string; // '' when not given
  year: number | null;
}

/** A card on the index (and the head of the profile page). */
interface InstructorSummary {
  slug: string;
  name: string;
  initials: string; // up to 2 letters, for the placeholder avatar
  color: string; // placeholder avatar colour (OKLCH L ≤ 0.55 — white text passes 4.5:1)
  avatarUrl: string | null; // absolute public image URL with ?v=…, render straight from there
  headline: string; // may be ''
  expertise: string[]; // ≤ 12 tags, display order
  stats: InstructorStats;
}

interface InstructorDetail extends InstructorSummary {
  coverUrl: string | null; // wide banner image (absolute, ?v=…); null → use `color`
  bioHtml: string; // safe HTML rendered by the API from the instructor's Markdown — insert as-is ('' when empty)
  bioExcerpt: string; // plain text, ≤ 280 chars (ellipsis when cut)
  credentials: InstructorCredential[]; // ≤ 10
  socialLinks: InstructorSocialLink[]; // ≤ 7, one per platform, in the order above
  website: string | null; // https:// URL
  courses: CourseSummary[]; // the catalogue card shape (catalog.md), newest first, ≤ 50
  seo: {
    title: string; // the profile's SEO title, else its name — apply the school's title template
    description: string; // SEO description, else the bio's first 160 chars, else the headline ('' possible)
    imageUrl: string | null; // share image: the cover, else the avatar; null → the site's generated og image
  };
  updatedAt: string | null; // sitemap lastmod
}
```

`bioHtml` contains only CommonMark's own elements (`p`, `strong`, `em`, `a`, `ul`/`ol`/`li`, `blockquote`, `code`,
`pre`, `h1`–`h6`, `hr`, `br`, GFM tables/strikethrough). Raw HTML the instructor typed is stripped, images are
removed, unsafe link schemes are dropped and every absolute link carries
`rel="nofollow noopener noreferrer" target="_blank"`. Style it inside a prose container.

## `GET /api/v1/instructors` — tags `t:<slug>:instructors`

Query: `page` (default 1), `per_page` (default 25, max 100), `sort` = `name` (default) | `-name`.

```
200 { data: InstructorSummary[], meta: { current_page, last_page, per_page, total, from, to } }
```

Ordered by name (then id). An empty list is `200 { data: [], meta: { total: 0, … } }` — the page shows an empty state
(and the site may hide its nav link while `total` is 0).

## `GET /api/v1/instructors/{slug}` — tags `t:<slug>:instructors`, `t:<slug>:instructor:<instructorSlug>`

`slug` matches `[a-z0-9-]{1,80}`.

```
200 { data: InstructorDetail }
404 { message: "Instructor not found." }   // unknown, unpublished, hidden (member left/suspended/role changed) or a former slug
401 { code: "site_locked", … }             // while the site is locked for the visitor
```

**Former slugs.** A renamed profile's old address answers `404` here. On that 404 the page asks
`GET /api/v1/redirects/resolve?path=/instructors/{oldSlug}` → `200 { data: { to: "/instructors/{newSlug}", status: 301 } }`
and redirects permanently (`404` from resolve → render the not-found page). A redirect the school made in SEO wins over
the automatic one. A former address of a hidden profile resolves to nothing.

## Course pages and cards (changes in catalog.md)

- `CourseSummary.instructor` is `Person & { slug: string | null }`. With a visible profile: the profile's name, its
  photo as `avatarUrl` and `slug` → link the name/photo to `/instructors/{slug}`. Otherwise the member's name, no
  photo, `slug: null` → plain text, no link.
- `CourseDetail.instructorProfile` = `{ role: "Instructor", bio, studentCount, slug, headline, courseCount, rating,
reviewCount }`. With a visible profile: `bio` = the bio excerpt (plain text ≤ 280), `studentCount` = the profile's
  `learnerCount`, `courseCount`/`rating`/`reviewCount` = its stats, `slug` set ("View profile" link). Otherwise
  `bio: ''`, `studentCount: 0`, `slug: null`, `headline: ''`, `courseCount: 0`, `rating: null`, `reviewCount: 0` —
  show the name only.

## SEO

- `generateMetadata`: title from `seo.title` through the school's template, description `seo.description`,
  canonical/hreflang via `pageAlternates`, `og:image` = `seo.imageUrl` (else the generated image), `og:type: profile`.
- JSON-LD: `ProfilePage` with `mainEntity: Person { name, description: headline, image: avatarUrl, sameAs: socialLinks[].url
  - website, jobTitle: headline }`. Index: `CollectionPage`/`ItemList`.
- Sitemap: `GET /api/v1/seo` → `sitemap[]` now also holds `/instructors` (when at least one profile is visible) and
  `/instructors/{slug}` (`updated_at`).

## Caching

Responses carry the public read headers (`Cache-Control: max-age=60, public, s-maxage=60, stale-while-revalidate=300`,
ETag, 304) unless the site lock is on (then `private, no-store`). Laravel sends to `/hooks/revalidate`:

| Change                                                                                                                       | Tags                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Profile published, unpublished, deleted, or edited/renamed/image changed while published; its member removed or role changed | `t:<slug>:instructors`, `t:<slug>:instructor:<slug>` (old and new slug), `t:<slug>:catalog`, `t:<slug>:course:<courseSlug>` for each course they teach |
| A course created/edited/published/unpublished                                                                                | also `t:<slug>:instructors` (profile pages list and count courses — tag every profile page with it)                                                    |

Figures (learners, ratings) move without a webhook: they are cached by the API for 5 minutes and by the site until the
next tag or its one-hour expiry.
