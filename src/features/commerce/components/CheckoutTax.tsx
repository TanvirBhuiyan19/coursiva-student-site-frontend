'use client';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { useFormat } from '@/lib/useFormat';
import type { Quote } from '../types';
import styles from './Commerce.module.css';

/**
 * The billing address's tax inputs: country, then the state or province where the country has them (required when
 * the quote says so), then the EU VAT number when the school reverse-charges. The API decides everything: the site
 * only sends what was chosen and prints the quote's verdict.
 */
export function TaxFields({
  quote,
  country,
  onCountry,
  region,
  onRegion,
  taxId,
  onTaxId,
  errors,
}: {
  quote: Quote | undefined;
  country: string;
  onCountry: (country: string) => void;
  region: string | null;
  onRegion: (region: string | null) => void;
  /** As typed (the quote gets it debounced). */
  taxId: string;
  onTaxId: (taxId: string) => void;
  errors: { region?: string; taxId?: string };
}) {
  const t = useTranslations('checkout');
  const id = useId();
  const subdivisions = (quote?.subdivisions ?? []).filter((s) => s.country === country);
  const details = quote?.taxDetails;
  const status = taxId.trim() ? (details?.taxId ?? null) : null;
  const taxIdMessage = errors.taxId ?? (status ? (status.status === 'valid' ? t('taxIdValid') : status.message) : null);
  const taxIdOk = !errors.taxId && status?.status === 'valid';
  return (
    <>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-country`}>
          {t('country')}
        </label>
        <select id={`${id}-country`} className="select" value={country} onChange={(e) => onCountry(e.target.value)}>
          {(quote?.countries ?? [country]).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {subdivisions.length > 0 && (
        <div className="field">
          <label className="field-label" htmlFor={`${id}-region`}>
            {t('region')}
          </label>
          <select
            id={`${id}-region`}
            className="select"
            value={region ?? ''}
            onChange={(e) => onRegion(e.target.value || null)}
            aria-required={details?.regionRequired || undefined}
            aria-invalid={!!errors.region}
            aria-describedby={errors.region ? `${id}-region-err` : undefined}
          >
            <option value="">{t('regionChoose')}</option>
            {subdivisions.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          {errors.region && (
            <p id={`${id}-region-err`} className="field-error" role="alert">
              {errors.region}
            </p>
          )}
        </div>
      )}
      {details?.acceptsTaxId && (
        <div className="field">
          <label className="field-label" htmlFor={`${id}-taxid`}>
            {t('taxId')}
          </label>
          <input
            id={`${id}-taxid`}
            className="input"
            autoComplete="off"
            spellCheck={false}
            maxLength={32}
            value={taxId}
            onChange={(e) => onTaxId(e.target.value)}
            aria-invalid={!!errors.taxId || status?.status === 'invalid'}
            aria-describedby={`${id}-taxid-status`}
          />
          <p
            id={`${id}-taxid-status`}
            className={taxIdMessage ? (taxIdOk ? styles.couponOk : styles.couponBad) : styles.extraSub}
            role="status"
          >
            {taxIdMessage ?? t('taxIdHint')}
          </p>
        </div>
      )}
    </>
  );
}

/** The tax line of the totals (checkout, receipt, invoice): added ("VAT (20%)"), included ("Includes GST (10%)") or "Reverse charge" (0). */
export function TaxLine({ label, amount, inclusive, reverseCharge }: TaxLineProps) {
  const t = useTranslations('checkout');
  const f = useFormat();
  return (
    <div>
      <dt>{inclusive && !reverseCharge ? t('taxIncluded', { label }) : label}</dt>
      <dd>{f.money(amount)}</dd>
    </div>
  );
}

interface TaxLineProps {
  label: string;
  amount: Quote['tax'];
  inclusive: boolean;
  reverseCharge: boolean;
}
