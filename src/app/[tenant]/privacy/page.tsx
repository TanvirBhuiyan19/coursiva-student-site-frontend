import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LegalDocumentView } from '@/features/account/components/LegalDocumentView';
import { getLegal } from '@/features/account/server';
import { currentTenant } from '@/features/tenant/server';
import { routes } from '@/lib/routes';
import { metaDescription } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getLegal(await currentTenant(), 'privacy');
  if (!doc) return {};
  return { title: doc.title, description: metaDescription(doc.sections[0]?.body ?? doc.title), alternates: { canonical: routes.privacy } };
}

export default async function PrivacyPage() {
  const doc = await getLegal(await currentTenant(), 'privacy');
  if (!doc) notFound();
  return <LegalDocumentView doc={doc} />;
}
