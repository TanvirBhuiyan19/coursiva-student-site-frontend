import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LegalDocumentView } from '@/features/account/components/LegalDocumentView';
import { getLegal } from '@/features/account/server';
import { currentScope, pageAlternates } from '@/features/tenant/server';
import { routes } from '@/lib/routes';
import { metaDescription } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { tenant, locale } = await currentScope();
  const [doc, { alternates }] = await Promise.all([getLegal(tenant, 'privacy', locale), pageAlternates(routes.privacy)]);
  if (!doc) return {};
  return { title: doc.title, description: metaDescription(doc.sections[0]?.body ?? doc.title), alternates };
}

export default async function PrivacyPage() {
  const { tenant, locale } = await currentScope();
  const doc = await getLegal(tenant, 'privacy', locale);
  if (!doc) notFound();
  return <LegalDocumentView doc={doc} />;
}
