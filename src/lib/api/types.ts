/** Shapes shared by every endpoint. The wire format is snake_case (Laravel); code sees camelCase (see ./case.ts). */

/** Money is always minor units (cents) plus an ISO 4217 code. Format with `formatMoney` — never do maths on the client. */
export interface Money {
  amount: number;
  currency: string;
}

export interface Resource<T> {
  data: T;
}

export interface PageMeta {
  currentPage: number;
  lastPage: number;
  perPage: number;
  total: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

/** Laravel's 422 body. */
export interface ValidationErrorBody {
  message: string;
  errors: Record<string, string[]>;
}

/** Image the API hands us: a CDN URL when the tenant uploaded one, otherwise a colour placeholder. */
export interface Cover {
  url: string | null;
  color: string;
  alt: string;
}

export interface Person {
  name: string;
  initials: string;
  avatarUrl: string | null;
  /** Placeholder avatar colour when there is no image. */
  color: string;
}
