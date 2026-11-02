'use client';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useFormat } from '@/lib/useFormat';
import { usePreview } from '../previewContext';
import type {
  LearnerBlock,
  LearnerButtonBlock,
  LearnerCodeBlock,
  LearnerFileBlock,
  LearnerGalleryBlock,
  LearnerImageBlock,
  LearnerPdfBlock,
  LearnerTableBlock,
} from '../types';
import {
  AccordionBlock,
  CheckBlock,
  ContinueBlock,
  FlashcardsBlock,
  HotspotsBlock,
  ProcessBlock,
  SortingBlock,
  TabsBlock,
  TimelineBlock,
} from './InteractiveBlocks';
import styles from './LessonBlocks.module.css';
import { VideoPlayer } from './VideoPlayer';

/**
 * A lesson's content blocks (course builder v2, `blocks` on `GET /me/lessons/{id}`), in order.
 *
 * Only `text` / `callout` carry HTML — the author's Markdown rendered by the API with raw HTML stripped and unsafe
 * links dropped (the `bodyHtml` rules), inserted as-is like `bodyHtml`. Every other string is plain text React escapes.
 * Media URLs are short-lived signed URLs on the storage host, so images are plain `<img>` (not next/image), like the
 * rest of lesson media. Block types this site doesn't know yet are skipped.
 *
 * In the player the lesson title is the h1, so block headings are h2/h3. `embedded` is for blocks inside a section that
 * already has an h2 (the course preview dialog): headings go one level down and full-width images stay in the box.
 *
 * Interactive blocks (accordion … continue, see InteractiveBlocks.tsx) answer to `POST /me/lessons/{lessonId}/blocks/…`.
 * Without a `lessonId` (the guest course preview) answers can't be checked and the first continue gate ends the content.
 * `blocksLocked` (the API's count of blocks withheld behind that gate) is hinted at the gate.
 */
export function LessonBlocks({
  blocks,
  lessonTitle,
  lessonId = null,
  blocksLocked = 0,
  embedded = false,
  className,
}: {
  blocks: LearnerBlock[];
  /** Names the block videos' players. */
  lessonTitle: string;
  /** The learner's lesson; null in the guest preview. */
  lessonId?: string | null;
  blocksLocked?: number;
  embedded?: boolean;
  className?: string;
}) {
  // The API stops at the first gate not passed; in the preview nothing after a gate is shown either way.
  const gate = blocks.findIndex((b) => b.type === 'continue' && !b.passed);
  const shown = gate >= 0 ? blocks.slice(0, gate + 1) : blocks;
  return (
    <div className={className ? `${styles.blocks} ${className}` : styles.blocks} data-embedded={embedded || undefined}>
      {shown.map((b, i) => (
        <Block
          key={b.id}
          block={b}
          lessonTitle={lessonTitle}
          headingOffset={embedded ? 1 : 0}
          lessonId={lessonId}
          locked={i === gate ? blocksLocked + (blocks.length - shown.length) : 0}
        />
      ))}
    </div>
  );
}

function Block({
  block: b,
  lessonTitle,
  headingOffset,
  lessonId,
  locked,
}: {
  block: LearnerBlock;
  lessonTitle: string;
  headingOffset: 0 | 1;
  lessonId: string | null;
  locked: number;
}) {
  const t = useTranslations('lessonBlocks');
  switch (b.type) {
    case 'heading': {
      const level = Math.min(Math.max(b.level, 2), 3) + headingOffset;
      const H = level === 2 ? 'h2' : level === 3 ? 'h3' : 'h4';
      return (
        <H className={styles.heading} data-level={b.level === 3 ? 3 : 2}>
          {b.text}
        </H>
      );
    }
    case 'text':
      // Sanitised by the API (LessonContent::html) — the only HTML a block may carry.
      return <div className={`rich-text ${styles.text}`} dangerouslySetInnerHTML={{ __html: b.html }} />;
    case 'callout': {
      const tone = (['info', 'tip', 'warning', 'success'] as const).includes(b.tone) ? b.tone : 'info';
      return (
        <div className={styles.callout} data-tone={tone} role="note" aria-label={t(`calloutTones.${tone}`)}>
          <span className={styles.calloutIcon} aria-hidden="true" />
          {/* Sanitised by the API, as for text blocks. */}
          <div className={`rich-text ${styles.calloutBody}`} dangerouslySetInnerHTML={{ __html: b.html }} />
        </div>
      );
    }
    case 'quote':
      return (
        <figure className={styles.quote} data-style={b.style === 'large' ? 'large' : 'plain'}>
          <blockquote className={styles.quoteText}>
            <p>{b.text}</p>
          </blockquote>
          {b.cite ? <figcaption className={styles.cite}>— {b.cite}</figcaption> : null}
        </figure>
      );
    case 'list':
      return b.style === 'numbered' ? (
        <ol className={styles.list} data-style="numbered">
          {b.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul className={styles.list} data-style={b.style === 'check' ? 'check' : 'bullet'}>
          {b.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case 'divider':
      return <hr className={styles.divider} />;
    case 'code':
      return <CodeBlock block={b} />;
    case 'button':
      return <ButtonBlock block={b} />;
    case 'table':
      return <TableBlock block={b} />;
    case 'image':
      return <ImageBlock block={b} />;
    case 'gallery':
      return b.items.length ? <GalleryBlock block={b} /> : null;
    case 'video':
      return (
        <div className={styles.media}>
          <VideoPlayer
            video={b}
            title={t('video', { title: lessonTitle })}
            durationSeconds={null}
            // Only the lesson's own video feeds the school's video analytics.
            reportLessonId={null}
          />
        </div>
      );
    case 'audio':
      return (
        <figure className={styles.audio}>
          <figcaption className={styles.mediaName}>{b.name}</figcaption>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- audio blocks carry no caption track in the API contract */}
          <audio controls preload="metadata" src={b.url} aria-label={t('audio', { name: b.name })} controlsList="nodownload">
            <a href={b.url}>{t('downloadName', { name: b.name })}</a>
          </audio>
        </figure>
      );
    case 'pdf':
      return <PdfBlock block={b} />;
    case 'file':
      return <FileBlock block={b} />;
    case 'embed':
      if (!/^https:\/\//i.test(b.src)) return null;
      return (
        <div className={styles.embed}>
          <iframe
            src={b.src}
            title={t('embed', { provider: b.provider })}
            height={Math.min(Math.max(b.height, 200), 1200)}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
            allow="fullscreen; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
          />
        </div>
      );
    case 'accordion':
      return b.items.length ? <AccordionBlock block={b} /> : null;
    case 'tabs':
      return b.items.length ? <TabsBlock block={b} /> : null;
    case 'process':
      return b.items.length ? <ProcessBlock block={b} /> : null;
    case 'timeline':
      return b.items.length ? <TimelineBlock block={b} /> : null;
    case 'flashcards':
      return b.cards.length ? <FlashcardsBlock block={b} /> : null;
    case 'hotspots':
      return <HotspotsBlock block={b} />;
    case 'sorting':
      return b.items.length && b.categories.length ? <SortingBlock block={b} lessonId={lessonId} /> : null;
    case 'check':
      return <CheckBlock block={b} lessonId={lessonId} />;
    case 'continue':
      return <ContinueBlock block={b} lessonId={lessonId} locked={locked} />;
    default:
      // A block type newer than this site: skipped.
      return null;
  }
}

function CodeBlock({ block: b }: { block: LearnerCodeBlock }) {
  const t = useTranslations('lessonBlocks');
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const label = b.language ? t('codeIn', { language: b.language }) : t('code');
  const onCopy = () => {
    clearTimeout(timer.current);
    const done = (s: 'copied' | 'failed') => {
      setCopy(s);
      timer.current = setTimeout(() => setCopy('idle'), 2500);
    };
    if (typeof navigator === 'undefined' || !('clipboard' in navigator)) {
      done('failed');
      return;
    }
    navigator.clipboard.writeText(b.code).then(
      () => done('copied'),
      () => done('failed'),
    );
  };
  return (
    <div className={styles.code}>
      <div className={styles.codeHead}>
        <span className={styles.codeLang}>{b.language || t('code')}</span>
        <span className={styles.copyState} aria-live="polite">
          {copy === 'copied' ? t('copied') : copy === 'failed' ? t('copyFailed') : ''}
        </span>
        <button type="button" className={styles.copyBtn} onClick={onCopy} aria-label={t('copyCode')}>
          {t('copy')}
        </button>
      </div>
      {/* Long lines scroll sideways: a focusable, labelled region so keyboard users can scroll it too. */}
      <pre className={styles.pre} tabIndex={0} role="region" aria-label={label}>
        <code>{b.code}</code>
      </pre>
    </div>
  );
}

/** Same-site links stay in the tab; anything else opens a new one. */
function isExternal(url: string): boolean {
  try {
    return typeof window === 'undefined' || new URL(url, window.location.href).origin !== window.location.origin;
  } catch {
    return true;
  }
}

function ButtonBlock({ block: b }: { block: LearnerButtonBlock }) {
  const t = useTranslations('lessonBlocks');
  // In the staff preview every link opens a new tab: the framed preview never navigates away from itself.
  const preview = usePreview();
  if (!/^https:\/\//i.test(b.url)) return null;
  const external = preview !== null || isExternal(b.url);
  return (
    <p className={styles.button}>
      <a
        href={b.url}
        className={`btn ${b.style === 'secondary' ? 'btn-outline' : 'btn-primary'}`}
        target={external ? '_blank' : undefined}
        rel="noopener noreferrer"
      >
        {b.label}
        {external && <span className="sr-only"> {t('newTab')}</span>}
      </a>
    </p>
  );
}

function TableBlock({ block: b }: { block: LearnerTableBlock }) {
  const t = useTranslations('lessonBlocks');
  const [head, ...rest] = b.rows;
  const body = b.header ? rest : b.rows;
  return (
    <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={t('table')}>
      <table className={styles.table}>
        {b.header && head && (
          <thead>
            <tr>
              {head.map((cell, i) => (
                <th key={i} scope="col">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImageBlock({ block: b }: { block: LearnerImageBlock }) {
  const width = b.width === 'wide' || b.width === 'full' ? b.width : 'normal';
  return (
    <figure className={styles.figure} data-width={width}>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived media URLs on the storage host, never via /_next/image */}
      <img className={styles.img} src={b.url} alt={b.alt} loading="lazy" decoding="async" />
      {b.caption ? <figcaption className={styles.caption}>{b.caption}</figcaption> : null}
    </figure>
  );
}

/**
 * A carousel: one image at a time, Previous/Next buttons and a strip of thumbnails. Arrow keys (and Home/End) move
 * between the thumbnails, which are buttons, so the gallery works without a pointer.
 */
function GalleryBlock({ block: b }: { block: LearnerGalleryBlock }) {
  const t = useTranslations('lessonBlocks');
  const id = useId();
  const [index, setIndex] = useState(0);
  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);
  const count = b.items.length;
  const i = Math.min(index, count - 1);
  const item = b.items[i]!;
  const go = (n: number, focus = false) => {
    const next = (n + count) % count;
    setIndex(next);
    if (focus) thumbs.current[next]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const rtl = typeof document !== 'undefined' && document.dir === 'rtl';
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
    if (step !== undefined) go(i + step, true);
    else if (e.key === 'Home') go(0, true);
    else if (e.key === 'End') go(count - 1, true);
    else return;
    e.preventDefault();
  };

  if (count === 1)
    return (
      <figure className={styles.figure} data-width="normal">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed media URL, see ImageBlock */}
        <img className={styles.img} src={item.url} alt={item.alt} loading="lazy" decoding="async" />
        {item.caption ? <figcaption className={styles.caption}>{item.caption}</figcaption> : null}
      </figure>
    );

  return (
    <section className={styles.gallery} aria-roledescription="carousel" aria-label={t('gallery')}>
      <figure className={styles.slide} aria-roledescription="slide" aria-labelledby={`${id}-n`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- signed media URL, see ImageBlock */}
        <img className={styles.slideImg} src={item.url} alt={item.alt} decoding="async" />
        {item.caption ? <figcaption className={styles.caption}>{item.caption}</figcaption> : null}
      </figure>
      <div className={styles.galleryBar}>
        <button type="button" className={styles.galleryNav} onClick={() => go(i - 1)} aria-label={t('previous')}>
          <span aria-hidden="true">←</span>
        </button>
        <p id={`${id}-n`} className={styles.galleryCount} aria-live="polite">
          {t('galleryStatus', { n: i + 1, count })}
        </p>
        <button type="button" className={styles.galleryNav} onClick={() => go(i + 1)} aria-label={t('next')}>
          <span aria-hidden="true">→</span>
        </button>
      </div>
      <div className={styles.thumbs}>
        {b.items.map((it, n) => (
          <button
            key={n}
            ref={(el) => {
              thumbs.current[n] = el;
            }}
            type="button"
            className={styles.thumb}
            aria-current={n === i ? 'true' : undefined}
            aria-label={t('showImage', { n: n + 1 })}
            tabIndex={n === i ? 0 : -1}
            onClick={() => go(n)}
            onKeyDown={onKey}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- signed media URL, see ImageBlock */}
            <img src={it.url} alt="" loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
    </section>
  );
}

function PdfBlock({ block: b }: { block: LearnerPdfBlock }) {
  const t = useTranslations('lessonBlocks');
  const f = useFormat();
  return (
    <figure className={styles.pdf}>
      {/* Inline viewer on larger screens; phones (which can't show PDFs inline reliably) get the link below only. */}
      {/* An iframe: the site's CSP is `object-src 'none'`, so <object>/<embed> never render. */}
      <iframe className={styles.pdfFrame} src={b.url} title={t('pdf', { name: b.name })} referrerPolicy="no-referrer" />
      <figcaption className={styles.fileCard}>
        <span className={styles.fileIcon} data-kind="pdf" aria-hidden="true">
          PDF
        </span>
        <span className={styles.fileText}>
          <span className={styles.fileName}>{b.name}</span>
          <span className={styles.fileMeta}>{t('pdfMeta', { size: f.bytes(b.sizeBytes) })}</span>
        </span>
        <a href={b.url} className="btn btn-outline btn-sm" target="_blank" rel="noopener noreferrer">
          {t('openPdf')}
          <span className="sr-only">
            {' '}
            {b.name} {t('newTab')}
          </span>
        </a>
      </figcaption>
    </figure>
  );
}

function FileBlock({ block: b }: { block: LearnerFileBlock }) {
  const t = useTranslations('lessonBlocks');
  const f = useFormat();
  const ext = /\.([a-z0-9]{1,5})$/i.exec(b.name)?.[1]?.toUpperCase() ?? '';
  return (
    <div className={styles.fileCard} data-standalone>
      <span className={styles.fileIcon} aria-hidden="true">
        {ext || '↓'}
      </span>
      <span className={styles.fileText}>
        <span className={styles.fileName}>{b.label || b.name}</span>
        <span className={styles.fileMeta}>
          {b.label ? `${b.name} · ` : ''}
          {f.bytes(b.sizeBytes)}
        </span>
      </span>
      <a href={b.url} className="btn btn-primary btn-sm" download aria-label={t('downloadName', { name: b.label || b.name })}>
        {t('download')}
      </a>
    </div>
  );
}
