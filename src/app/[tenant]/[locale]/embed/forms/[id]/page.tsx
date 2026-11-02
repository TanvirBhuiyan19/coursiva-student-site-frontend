import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { EmbedFrame } from '@/features/forms/components/EmbedFrame';
import { isFormId } from '@/features/forms/ids';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('forms');
  return { title: t('pageTitle'), robots: { index: false, follow: false } };
}

/**
 * The embed frame (`/embed/forms/{id}?origin=…&page=…`), put on other websites by `/embed/forms.js`. Framable by any
 * site (src/lib/securityHeaders.ts); the layout leaves out the site's header, footer and banners on `/embed/`. The
 * query is read in the browser only, so the page stays static.
 */
export default async function EmbedFormPage({ params }: PageProps<'/[tenant]/[locale]/embed/forms/[id]'>) {
  const { id } = await params;
  if (!isFormId(id)) notFound();
  return <EmbedFrame formId={id} />;
}
