import { Fragment, type ReactNode } from 'react';

/**
 * A small, safe Markdown renderer for school-written text (blog posts, assignment briefs, grading feedback, product
 * descriptions). It builds React elements — never HTML strings — so nothing the author typed can run as script.
 * Supported: `#`–`######` headings (shifted down: the page owns the h1, see `headingLevel`), paragraphs, `>` quotes,
 * `-`/`*`/`1.` lists, `---` rules, `**bold**`, `*italic*`, `***both***`, `` `code` ``, `[links](https://…)` (an
 * optional `"title"` is dropped) and `![images](https://…)`. Only http(s), mailto and same-site links are kept.
 *
 * Emphasis follows CommonMark's flanking rule (no space just inside the stars), so plain text such as `2 * 3 * 4`
 * stays as typed — these fields held plain text before the dashboard's rich text editor. CommonMark backslash escapes
 * are honoured (the editor saves a literal `*` as `\*`, `_` as `\_`, `\` as `\\`…): a backslash before ASCII
 * punctuation gives that character literally and never starts or ends formatting; inside `` `code` `` the backslash
 * stays. A backslash ending a paragraph line is a hard line break.
 */

const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/))/i;

export function safeHref(url: string): string | null {
  const u = url.trim();
  return SAFE_URL.test(u) ? u : null;
}

export interface MarkdownOptions {
  /**
   * Keep single newlines inside a paragraph, quote or list item as line breaks (and let an unmarked line continue the
   * list item or quote above it). For fields that were plain text typed in a textarea, where a newline meant one.
   * Off by default: CommonMark joins the lines with a space (the blog).
   */
  breaks?: boolean;
  /** Render `![alt](https://…)` images; false shows the alt text instead (fields whose editor has no images). */
  images?: boolean;
}

// 1 alt, 2 src · 3 label, 4 href · 5 bold+italic · 6 bold · 7 italic · 8 code
const INLINE = new RegExp(
  [
    /!\[([^\]]*)\]\(([^)\s]+)\)/.source,
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.source,
    /\*\*\*(?!\s)([^*]+?)(?<!\s)\*\*\*/.source,
    /\*\*(?!\s)((?:[^*]|\*(?!\*))+?)(?<!\s)\*\*/.source,
    /\*(?![\s*])((?:\*\*[^*]+\*\*|[^*])+?)(?<!\s)\*/.source,
    /`([^`]+)`/.source,
  ].join('|'),
  'g',
);

// Backslash escapes: before tokenising, `\X` (X = ASCII punctuation) becomes a private-use stand-in (U+E000 + the code
// of X) that no pattern matches; output turns it back into X (into `\X` inside code, where escapes don't apply).
// Private-use characters of that range already in the source are replaced first, so they can't pose as escapes.
const ESC = 0xe000;
const STAND_INS = /[-]/g;
const ESCAPED = /\\([!-/:-@[-`{-~])/g;
const escapeIn = (s: string) => s.replace(STAND_INS, '�').replace(ESCAPED, (_m, c: string) => String.fromCharCode(ESC + c.charCodeAt(0)));
const unescape = (s: string) => s.replace(STAND_INS, (c) => String.fromCharCode(c.charCodeAt(0) - ESC));
const unescapeInCode = (s: string) => s.replace(STAND_INS, (c) => `\\${String.fromCharCode(c.charCodeAt(0) - ESC)}`);

/** Text with its newlines (line breaks) as `<br>`s, escapes resolved. */
function lines(text: string, key: string): ReactNode[] {
  if (!text.includes('\n')) return [unescape(text)];
  return text.split('\n').flatMap((t, i) => (i === 0 ? [unescape(t)] : [<br key={`${key}-br${i}`} />, unescape(t)]));
}

/** Inline formatting inside one block. */
export function inline(source: string, key = 'i', opts: MarkdownOptions = {}): ReactNode[] {
  return tokens(escapeIn(source), key, opts);
}

/** `inline` on text whose escapes are already stand-ins (recursion keeps them, so nothing is unescaped twice). */
function tokens(text: string, key: string, opts: MarkdownOptions): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(INLINE.source, 'g');
  let last = 0;
  let n = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(...lines(text.slice(last, m.index), `${key}-t${n}`));
    const k = `${key}-${n++}`;
    if (m[2] !== undefined) {
      const src = opts.images === false ? null : safeHref(unescape(m[2]));
      const alt = unescape(m[1] ?? '');
      // eslint-disable-next-line @next/next/no-img-element -- author content from arbitrary hosts; next/image needs known hosts
      out.push(src && /^https?:/i.test(src) ? <img key={k} src={src} alt={alt} loading="lazy" /> : alt);
    } else if (m[4] !== undefined) {
      const href = safeHref(unescape(m[4]));
      const label = tokens(m[3] ?? '', k, opts);
      out.push(
        href ? (
          <a key={k} href={href} rel={href.startsWith('/') ? undefined : 'noopener noreferrer nofollow ugc'}>
            {label}
          </a>
        ) : (
          <Fragment key={k}>{label}</Fragment>
        ),
      );
    } else if (m[5] !== undefined)
      out.push(
        <strong key={k}>
          <em>{tokens(m[5], k, opts)}</em>
        </strong>,
      );
    else if (m[6] !== undefined) out.push(<strong key={k}>{tokens(m[6], k, opts)}</strong>);
    else if (m[7] !== undefined) out.push(<em key={k}>{tokens(m[7], k, opts)}</em>);
    else if (m[8] !== undefined) out.push(<code key={k}>{unescapeInCode(m[8])}</code>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(...lines(text.slice(last), `${key}-t${n}`));
  return out;
}

/** An odd run of backslashes at the end of a line. */
const HARD_BREAK = /(?:^|[^\\])(?:\\\\)*\\$/;

type Block =
  | { kind: 'h'; depth: number; text: string }
  | { kind: 'p' | 'quote'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'hr' };

export function parseBlocks(md: string, opts: Pick<MarkdownOptions, 'breaks'> = {}): Block[] {
  const join = opts.breaks ? '\n' : ' ';
  const blocks: Block[] = [];
  const lns = md.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let blank = true;
  const flush = () => {
    // A line ending in an unescaped backslash is a hard line break (the backslash isn't shown).
    const parts = para.map((l, i) => (i === para.length - 1 ? l : HARD_BREAK.test(l) ? `${l.slice(0, -1)}\n` : `${l}${join}`));
    if (para.length) blocks.push({ kind: 'p', text: parts.join('') });
    para = [];
  };
  for (const raw of lns) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    const prev = blocks.at(-1);
    if (!line) flush();
    else if (/^(-{3,}|\*{3,})$/.test(line)) {
      flush();
      blocks.push({ kind: 'hr' });
    } else if (heading) {
      flush();
      blocks.push({ kind: 'h', depth: heading[1]!.length, text: heading[2] ?? '' });
    } else if (line.startsWith('>')) {
      flush();
      const text = line.replace(/^>\s?/, '');
      if (prev?.kind === 'quote') prev.text += `${join}${text}`;
      else blocks.push({ kind: 'quote', text });
    } else if (bullet || numbered) {
      flush();
      const kind = bullet ? 'ul' : 'ol';
      const item = (bullet ?? numbered)![1] ?? '';
      if (prev && prev.kind === kind) prev.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (opts.breaks && !blank && !para.length && (prev?.kind === 'quote' || prev?.kind === 'ul' || prev?.kind === 'ol')) {
      // A lazy continuation line: the list item or quote goes on, on a new line.
      if ('items' in prev) prev.items.push(`${prev.items.pop() ?? ''}\n${line}`);
      else if ('text' in prev) prev.text += `\n${line}`;
    } else para.push(line);
    blank = !line;
  }
  flush();
  return blocks;
}

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

export function Markdown({
  source,
  className,
  breaks = false,
  images = true,
  headingLevel,
}: MarkdownOptions & {
  source: string;
  className?: string;
  /**
   * The HTML level of the source's top heading, the others following it (capped at h6) — set it from where the field
   * sits: under the page's h1 → 2, inside an h2 section → 3, … Without it, `#` is an h2, `##` an h3 and so on (blog).
   */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
}) {
  const opts = { breaks, images };
  const blocks = parseBlocks(source, opts);
  const depths = blocks.flatMap((b) => (b.kind === 'h' ? [b.depth] : []));
  const top = depths.length ? Math.min(...depths) : 1;
  const level = (depth: number) => Math.min(6, headingLevel === undefined ? depth + 1 : headingLevel + depth - top);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.kind) {
          case 'h': {
            const H = HEADINGS[level(b.depth) - 1]!;
            return <H key={k}>{inline(b.text, k, opts)}</H>;
          }
          case 'quote':
            return <blockquote key={k}>{inline(b.text, k, opts)}</blockquote>;
          case 'ul':
            return (
              <ul key={k}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `${k}-${j}`, opts)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={k}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `${k}-${j}`, opts)}</li>
                ))}
              </ol>
            );
          case 'hr':
            return <hr key={k} />;
          default:
            return <p key={k}>{inline(b.text, k, opts)}</p>;
        }
      })}
    </div>
  );
}

/** The text inside inline formatting: link labels, image alt text, emphasis and code without their markers. */
function plainInline(source: string): string {
  return unescape(plainTokens(escapeIn(source)));
}

function plainTokens(text: string): string {
  return text.replace(
    new RegExp(INLINE.source, 'g'),
    (_m, alt?: string, _src?: string, label?: string, _href?: string, b3?: string, b2?: string, b1?: string, code?: string) =>
      alt !== undefined ? alt : code !== undefined ? unescapeInCode(code) : plainTokens(label ?? b3 ?? b2 ?? b1 ?? ''),
  );
}

/**
 * School-written Markdown as plain text, for places that show it on one line or outside the page body: cards, list
 * rows, checkout lines, `<meta>` descriptions, JSON-LD. Markers are dropped (headings, quotes, list bullets, rules,
 * emphasis, code ticks), links keep their label and images their alt text. Blocks and line breaks become newlines;
 * HTML collapses them to spaces and `metaDescription()` does the same.
 */
export function markdownToPlain(md: string): string {
  return parseBlocks(md, { breaks: true })
    .flatMap((b) => (b.kind === 'hr' ? [] : 'items' in b ? b.items : [b.text]))
    .map((t) => plainInline(t).trim())
    .filter(Boolean)
    .join('\n');
}
