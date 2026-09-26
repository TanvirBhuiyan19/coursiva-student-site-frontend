import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LegalDocumentView } from '@/features/account/components/LegalDocumentView';
import { getLegal } from '@/features/account/server';
import { currentTenant } from '@/features/tenant/server';
import { routes } from '@/lib/routes';
import { metaDescription } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getLegal(await currentTenant(), 'terms');
  if (!doc) return {};
  return { title: doc.title, description: metaDescription(doc.sections[0]?.body ?? doc.title), alternates: { canonical: routes.terms } };
}

export default async function TermsPage() {
  const doc = await getLegal(await currentTenant(), 'terms');
  if (!doc) notFound();
  return <LegalDocumentView doc={doc} />;
}
