import type { Metadata } from 'next';
import { LegalPage, legalMetadata } from '@/features/account/components/LegalPage';

export function generateMetadata(): Promise<Metadata> {
  return legalMetadata('refund');
}

export default function RefundPage() {
  return <LegalPage kind="refund" />;
}
