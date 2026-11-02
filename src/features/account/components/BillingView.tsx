'use client';
import { useTranslations } from 'next-intl';
import { useProfile } from '../api';
import { BillingSection } from './BillingSection';
import { SubscriptionsSection } from './SubscriptionsSection';

export function BillingView() {
  const tc = useTranslations('common');
  const { data, isPending, isError, refetch } = useProfile();
  if (isPending) return <div className="skeleton" style={{ height: 220, marginTop: 24 }} />;
  if (isError)
    return (
      <div className="alert alert-bad" role="alert" style={{ marginTop: 24 }}>
        {tc('errorBody')}{' '}
        <button type="button" className="link-btn" onClick={() => void refetch()}>
          {tc('retry')}
        </button>
      </div>
    );
  return (
    <>
      <BillingSection profile={data} hideMembership />
      <SubscriptionsSection />
    </>
  );
}
