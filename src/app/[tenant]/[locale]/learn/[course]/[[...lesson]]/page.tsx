import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Player } from '@/features/learning/components/Player';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** `/learn/<course>` resumes; `/learn/<course>/<lesson>` opens a lesson. Enrolment is checked by the API. */
export default async function PlayerPage({ params }: PageProps<'/[tenant]/[locale]/learn/[course]/[[...lesson]]'>) {
  const { course, lesson } = await params;
  return (
    <Suspense>
      <Player courseSlug={course} lessonId={lesson?.[0] ?? null} />
    </Suspense>
  );
}
