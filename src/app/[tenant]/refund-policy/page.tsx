import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LegalDocumentView } from '@/features/account/components/LegalDocumentView';
import { getLegal } from '@/features/account/server';
import { currentTenant } from '@/features/tenant/server';
import { routes } from '@/lib/routes';
import { metaDescription } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getLegal(await currentTenant(), 'refund');
  if (!doc) return {};
  return { title: doc.title, description: metaDescription(doc.sections[0]?.body ?? doc.title), alternates: { canonical: routes.refund } };
}

export default async function RefundPage() {
  const doc = await getLegal(await currentTenant(), 'refund');
  if (!doc) notFound();
  return <LegalDocumentView doc={doc} />;
}
