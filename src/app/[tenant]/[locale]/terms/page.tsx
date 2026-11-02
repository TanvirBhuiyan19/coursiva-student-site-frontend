import type { Metadata } from 'next';
import { LegalPage, legalMetadata } from '@/features/account/components/LegalPage';

export function generateMetadata(): Promise<Metadata> {
  return legalMetadata('terms');
}

export default function TermsPage() {
  return <LegalPage kind="terms" />;
}
