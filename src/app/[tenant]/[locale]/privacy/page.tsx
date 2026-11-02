import type { Metadata } from 'next';
import { LegalPage, legalMetadata } from '@/features/account/components/LegalPage';

export function generateMetadata(): Promise<Metadata> {
  return legalMetadata('privacy');
}

export default function PrivacyPage() {
  return <LegalPage kind="privacy" />;
}
