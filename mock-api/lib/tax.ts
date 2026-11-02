/**
 * The tax engine (Laravel App\Modules\Commerce\Tax\TaxEngine): the school's registrations decide whether and how a
 * buyer is taxed. The mock uses the fake VIES checker of Laravel's `testing` env: a VAT number ending "000" isn't
 * registered, "999" can't be checked right now, anything else is valid.
 */
import type { Subdivision, TaxDetails } from '@/features/commerce/types';
import type { TaxRegistrationRow, TenantData } from './records';

/** Standard VAT/GST rates, % (TaxRates::RATES). */
export const RATES: Record<string, [string, number]> = {
  'United Kingdom': ['VAT', 20],
  Germany: ['VAT', 19],
  France: ['VAT', 20],
  Spain: ['VAT', 21],
  Italy: ['VAT', 22],
  Netherlands: ['VAT', 21],
  Belgium: ['VAT', 21],
  Ireland: ['VAT', 23],
  Portugal: ['VAT', 23],
  Austria: ['VAT', 20],
  Sweden: ['VAT', 25],
  Denmark: ['VAT', 25],
  Finland: ['VAT', 25.5],
  Poland: ['VAT', 23],
  Czechia: ['VAT', 21],
  Greece: ['VAT', 24],
  Romania: ['VAT', 19],
  Hungary: ['VAT', 27],
  Luxembourg: ['VAT', 17],
  Australia: ['GST', 10],
  'New Zealand': ['GST', 15],
  Canada: ['GST', 5],
  India: ['GST', 18],
  Singapore: ['GST', 9],
};

/** Countries offered at checkout (TaxRates::COUNTRIES). */
export const COUNTRIES = [
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
  'New Zealand',
  'Ireland',
  'Germany',
  'France',
  'Spain',
  'Italy',
  'Netherlands',
  'Belgium',
  'Portugal',
  'Austria',
  'Sweden',
  'Denmark',
  'Finland',
  'Poland',
  'Czechia',
  'Greece',
  'Romania',
  'Hungary',
  'Luxembourg',
  'India',
  'Singapore',
  'Bangladesh',
  'Pakistan',
  'Nigeria',
  'South Africa',
  'Brazil',
  'Mexico',
  'United Arab Emirates',
  'Japan',
];

/** EU members and their VAT number prefix and format (VatIds::PATTERNS; Greece is EL). */
const EU_VAT: Record<string, [string, RegExp]> = {
  Austria: ['AT', /^U\d{8}$/],
  Belgium: ['BE', /^[01]\d{9}$/],
  Czechia: ['CZ', /^\d{8,10}$/],
  Germany: ['DE', /^\d{9}$/],
  Denmark: ['DK', /^\d{8}$/],
  Greece: ['EL', /^\d{9}$/],
  Spain: ['ES', /^[0-9A-Z]\d{7}[0-9A-Z]$/],
  Finland: ['FI', /^\d{8}$/],
  France: ['FR', /^[0-9A-Z]{2}\d{9}$/],
  Hungary: ['HU', /^\d{8}$/],
  Ireland: ['IE', /^(\d{7}[A-W][A-I]?|\d[A-Z+*]\d{5}[A-W])$/],
  Italy: ['IT', /^\d{11}$/],
  Luxembourg: ['LU', /^\d{8}$/],
  Netherlands: ['NL', /^\d{9}B\d{2}$/],
  Poland: ['PL', /^\d{10}$/],
  Portugal: ['PT', /^\d{9}$/],
  Romania: ['RO', /^\d{2,10}$/],
  Sweden: ['SE', /^\d{12}$/],
};

const US_STATES: [string, string][] = [
  ['AL', 'Alabama'],
  ['AK', 'Alaska'],
  ['AZ', 'Arizona'],
  ['AR', 'Arkansas'],
  ['CA', 'California'],
  ['CO', 'Colorado'],
  ['CT', 'Connecticut'],
  ['DE', 'Delaware'],
  ['DC', 'District of Columbia'],
  ['FL', 'Florida'],
  ['GA', 'Georgia'],
  ['HI', 'Hawaii'],
  ['ID', 'Idaho'],
  ['IL', 'Illinois'],
  ['IN', 'Indiana'],
  ['IA', 'Iowa'],
  ['KS', 'Kansas'],
  ['KY', 'Kentucky'],
  ['LA', 'Louisiana'],
  ['ME', 'Maine'],
  ['MD', 'Maryland'],
  ['MA', 'Massachusetts'],
  ['MI', 'Michigan'],
  ['MN', 'Minnesota'],
  ['MS', 'Mississippi'],
  ['MO', 'Missouri'],
  ['MT', 'Montana'],
  ['NE', 'Nebraska'],
  ['NV', 'Nevada'],
  ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'],
  ['NY', 'New York'],
  ['NC', 'North Carolina'],
  ['ND', 'North Dakota'],
  ['OH', 'Ohio'],
  ['OK', 'Oklahoma'],
  ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'],
  ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'],
  ['SD', 'South Dakota'],
  ['TN', 'Tennessee'],
  ['TX', 'Texas'],
  ['UT', 'Utah'],
  ['VT', 'Vermont'],
  ['VA', 'Virginia'],
  ['WA', 'Washington'],
  ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'],
];

const CA_PROVINCES: [string, string][] = [
  ['AB', 'Alberta'],
  ['BC', 'British Columbia'],
  ['MB', 'Manitoba'],
  ['NB', 'New Brunswick'],
  ['NL', 'Newfoundland and Labrador'],
  ['NS', 'Nova Scotia'],
  ['NT', 'Northwest Territories'],
  ['NU', 'Nunavut'],
  ['ON', 'Ontario'],
  ['PE', 'Prince Edward Island'],
  ['QC', 'Quebec'],
  ['SK', 'Saskatchewan'],
  ['YT', 'Yukon'],
];

/** TaxRates::SUBDIVISIONS (US states + DC, Canadian provinces and territories). */
export const SUBDIVISIONS: Subdivision[] = [
  ...US_STATES.map(([code, name]) => ({ country: 'United States', code, name })),
  ...CA_PROVINCES.map(([code, name]) => ({ country: 'Canada', code, name })),
];

export const REVERSE_CHARGE_NOTE = 'VAT reverse charge: the customer accounts for VAT (Article 196, Council Directive 2006/112/EC).';
export const REGION_REQUIRED = 'Choose your state or province.';
export const REGION_UNKNOWN = 'Choose a state or province from the list.';

/** The derived region of a registration: "European Union (OSS)", "United States — California", or the country. */
export function regionName(r: Pick<TaxRegistrationRow, 'country' | 'subdivision'>): string {
  if (r.country === 'European Union') return 'European Union (OSS)';
  if (r.subdivision) {
    const name = SUBDIVISIONS.find((s) => s.country === r.country && s.code === r.subdivision)?.name ?? r.subdivision;
    return `${r.country} — ${name}`;
  }
  return r.country;
}

export interface TaxResolution {
  /** null = no tax. */
  rate: number | null;
  label: string | null;
  inclusive: boolean;
  reverseCharge: boolean;
  registration: TaxRegistrationRow | null;
  details: TaxDetails;
  /** `422 region` for an unknown state/province (quote and checkout); the required one is checked at checkout only. */
  regionError: string | null;
}

/** VIES, faked like Laravel's `testing` binding. */
function vies(number: string): 'valid' | 'invalid' | 'unavailable' {
  if (number.endsWith('000')) return 'invalid';
  if (number.endsWith('999')) return 'unavailable';
  return 'valid';
}

/** TaxEngine::resolve: the matching registered row, the rate, and the reverse charge for a verified EU VAT number. */
export function resolveTax(t: TenantData, country: string, region: string | null, taxId: string | null): TaxResolution {
  const regs = (t.taxRegistrations ?? []).filter((r) => r.registered);
  const hasSubdivisions = SUBDIVISIONS.some((s) => s.country === country);
  const regionError = region && !SUBDIVISIONS.some((s) => s.country === country && s.code === region) ? REGION_UNKNOWN : null;
  const regionRequired = hasSubdivisions && !region && regs.some((r) => r.country === country && r.subdivision !== null);
  const eu = country in EU_VAT;
  const reg =
    (region ? regs.find((r) => r.country === country && r.subdivision === region) : undefined) ??
    regs.find((r) => r.country === country && r.subdivision === null) ??
    (eu ? regs.find((r) => r.country === 'European Union') : undefined) ??
    null;
  const rate = reg ? (reg.rate ?? RATES[country]?.[1] ?? null) : null;
  const none: TaxResolution = {
    rate: null,
    label: null,
    inclusive: false,
    reverseCharge: false,
    registration: null,
    regionError,
    details: {
      inclusive: false,
      rate: null,
      reverseCharge: false,
      region: null,
      provider: null,
      note: null,
      acceptsTaxId: false,
      regionRequired,
      taxId: null,
    },
  };
  if (!reg || rate === null) return none;
  const kind = reg.country === 'European Union' ? 'VAT' : reg.kind;
  const acceptsTaxId = reg.reverseCharge && eu;
  let taxIdStatus: TaxDetails['taxId'] = null;
  let reverseCharge = false;
  const typed = (taxId ?? '').trim();
  if (acceptsTaxId && typed) {
    const [prefix, pattern] = EU_VAT[country]!;
    let n = typed.toUpperCase().replace(/[\s.-]/g, '');
    if (n.startsWith(prefix)) n = n.slice(prefix.length);
    if (!pattern.test(n)) taxIdStatus = { status: 'invalid', message: `Enter a valid ${country} VAT number.` };
    else {
      const check = vies(n);
      if (check === 'valid') {
        reverseCharge = true;
        taxIdStatus = { status: 'valid', message: null };
      } else if (check === 'invalid') taxIdStatus = { status: 'invalid', message: 'This VAT number isn’t registered in VIES.' };
      else taxIdStatus = { status: 'unverified', message: 'We couldn’t verify this VAT number right now, so VAT is charged.' };
    }
  }
  return {
    rate,
    label: reverseCharge ? 'Reverse charge' : `${kind} (${String(rate)}%)`,
    inclusive: reg.inclusive,
    reverseCharge,
    registration: reg,
    regionError,
    details: {
      inclusive: reg.inclusive,
      rate,
      reverseCharge,
      region: regionName(reg),
      provider: 'builtin',
      note: reverseCharge ? REVERSE_CHARGE_NOTE : null,
      acceptsTaxId,
      regionRequired,
      taxId: taxIdStatus,
    },
  };
}

/** TaxEngine::apply for one chunk: the tax amount (added when exclusive, extracted when inclusive). */
export function taxOn(tax: TaxResolution, taxable: number): number {
  if (tax.rate === null || tax.reverseCharge || taxable <= 0) return 0;
  return tax.inclusive ? taxable - Math.round((taxable * 100) / (100 + tax.rate)) : Math.round((taxable * tax.rate) / 100);
}

/** What the chunk adds to the total: its tax when exclusive, nothing when the prices include it. */
export const addedTax = (tax: TaxResolution, taxable: number) => (tax.inclusive ? 0 : taxOn(tax, taxable));

/** Spreads the items' tax over the lines by unit price × quantity (floor each share, the remainder to the last line). */
export function spreadTax(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (!sum || !total) return weights.map(() => 0);
  const shares = weights.map((w) => Math.floor((total * w) / sum));
  shares[shares.length - 1]! += total - shares.reduce((a, s) => a + s, 0);
  return shares;
}

/** Invoices::issue: the next number in the `invoices` sequence, once per order, when it is paid. */
export function issueInvoice(t: TenantData, order: { invoiceNumber?: number | null; invoicePrefix?: string | null }) {
  if (order.invoiceNumber) return;
  t.lastInvoiceNumber = (t.lastInvoiceNumber ?? 0) + 1;
  order.invoiceNumber = t.lastInvoiceNumber;
  order.invoicePrefix = t.invoicePrefix ?? 'INV-';
}

/** CreditNotes::issue: the next number in the `credit_notes` sequence, one per refund. */
export function issueCreditNote(
  t: TenantData,
  order: { creditNotes?: { number: number; prefix: string; amount: number; createdAt: string }[] },
  amount: number,
  at: string,
) {
  t.lastCreditNoteNumber = (t.lastCreditNoteNumber ?? 0) + 1;
  order.creditNotes = [...(order.creditNotes ?? []), { number: t.lastCreditNoteNumber, prefix: 'CN-', amount, createdAt: at }];
}

/** "INV-0001" (zero-padded to 4 digits). */
export const invoiceDisplay = (prefix: string | null | undefined, n: number | null | undefined) =>
  n ? `${prefix ?? 'INV-'}${String(n).padStart(4, '0')}` : null;
