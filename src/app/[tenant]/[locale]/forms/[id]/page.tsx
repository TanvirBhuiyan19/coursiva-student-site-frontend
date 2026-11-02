import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LeadForm } from '@/features/forms/components/LeadForm';
import { isFormId } from '@/features/forms/ids';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('forms');
  return { title: t('pageTitle'), robots: { index: false, follow: false } };
}

/**
 * A lead form's hosted page (`/forms/{id}`, the dashboard's "hosted link"): the school's chrome around the form. The
 * form and its token load in the browser (a token must never be cached into the page), so the page itself is static.
 */
export default async function HostedFormPage({ params }: PageProps<'/[tenant]/[locale]/forms/[id]'>) {
  const { id } = await params;
  if (!isFormId(id)) notFound();
  return (
    <div className="container page" style={{ paddingTop: 56, paddingBottom: 90 }}>
      <LeadForm formId={id} variant="page" />
    </div>
  );
}
