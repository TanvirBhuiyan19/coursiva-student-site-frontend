import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PreviewPlayer } from '@/features/learning/components/PreviewPlayer';
import { getPreview, getPreviewLesson, isPreviewToken } from '@/features/learning/server';
import { currentScope } from '@/features/tenant/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('preview');
  // The token is in the URL: never indexed, and no referrer leaves the page (the proxy sends the headers too).
  return { title: t('metaTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/** Per request: the token, the simulated now and the expiry make every render different (and private). */
export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The staff preview (course builder O7): the dashboard frames `/preview/{token}` (`?lesson=` opens a lesson, else the
 * first one). A dead token is the "expired" page (not-found.tsx). Locked lessons stay viewable here.
 */
export default async function PreviewPage({ params, searchParams }: PageProps<'/[tenant]/[locale]/preview/[token]'>) {
  const [{ token }, sp, { tenant, locale }] = await Promise.all([params, searchParams, currentScope()]);
  if (!isPreviewToken(token)) notFound();
  const session = await getPreview(tenant, token, locale);
  if (!session.ok) notFound();
  const lessons = session.data.course.modules.flatMap((m) => m.lessons);
  const lessonId = one(sp.lesson) ?? lessons[0]?.id ?? null;
  const lesson = lessonId ? await getPreviewLesson(tenant, token, lessonId, locale) : null;
  return <PreviewPlayer token={token} session={session.data} lesson={lesson?.ok ? lesson.data : null} />;
}
