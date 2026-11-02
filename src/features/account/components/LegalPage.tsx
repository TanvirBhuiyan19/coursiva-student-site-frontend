import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { LegalScreen } from '@/features/tenant/types';
import { currentScope, getSite, pageAlternates } from '@/features/tenant/server';
import { Link } from '@/i18n/navigation';
import { Markdown, markdownToPlain } from '@/lib/markdown';
import { routes } from '@/lib/routes';
import { metaDescription } from '@/lib/seo';
import { getLegal } from '../server';
import { LegalDocumentView } from './LegalDocumentView';
import styles from './Support.module.css';

type Kind = 'privacy' | 'terms' | 'refund';

const SCREEN = { privacy: 'privacy', terms: 'terms', refund: 'refundPolicy' } as const;
const PATH = { privacy: routes.privacy, terms: routes.terms, refund: routes.refund } as const;

/**
 * The school's legal page. When it built the page in the site builder (a `legal` section on `/privacy`, `/terms` or
 * `/refund-policy` → `GET /site` → `screens.legal`), that is what learners read; otherwise today's document
 * (`GET /legal/{slug}`).
 */
async function load(kind: Kind) {
  const { tenant, locale } = await currentScope();
  const site = await getSite(tenant, locale);
  const screen = site.screens.legal[SCREEN[kind]];
  return { screen, doc: screen ? null : await getLegal(tenant, kind, locale) };
}

export async function legalMetadata(kind: Kind): Promise<Metadata> {
  const [{ screen, doc }, { alternates }] = await Promise.all([load(kind), pageAlternates(PATH[kind])]);
  if (screen) {
    // Section bodies are Markdown: the meta description is their plain text.
    const first = screen.sections[0]?.body;
    return { title: screen.title, description: metaDescription(first ? markdownToPlain(first) : screen.title), alternates };
  }
  if (!doc) return {};
  return { title: doc.title, description: metaDescription(doc.sections[0]?.body ?? doc.title), alternates };
}

export async function LegalPage({ kind }: { kind: Kind }) {
  const { screen, doc } = await load(kind);
  if (screen) return <LegalScreenView screen={screen} />;
  if (!doc) notFound();
  return <LegalDocumentView doc={doc} />;
}

/** A legal page as the school wrote it in the builder: title, its own "updated" line, headed paragraphs, footer. */
export function LegalScreenView({ screen }: { screen: LegalScreen }) {
  return (
    <article className={`container page ${styles.legal}`}>
      {screen.back !== '' && (
        <Link href={routes.help} className={styles.back}>
          {screen.back}
        </Link>
      )}
      <h1 className="h1-sm" style={{ marginTop: screen.back !== '' ? 10 : 0 }}>
        {screen.title}
      </h1>
      {screen.updated !== '' && <p className={styles.updated}>{screen.updated}</p>}
      {screen.sections.map((s, i) => (
        <section key={i} className={styles.legalSection}>
          {s.heading !== '' && <h2>{s.heading}</h2>}
          {/* The builder's rich text (Markdown); `breaks` keeps older plain text's line breaks. */}
          <Markdown source={s.body} breaks images={false} headingLevel={3} className={`rich-text ${styles.legalBody}`} />
        </section>
      ))}
      {screen.footer !== '' && <aside className={styles.legalCta}>{screen.footer}</aside>}
    </article>
  );
}
