import 'server-only';
import { cache } from 'react';
import { apiGetOrNull, cacheTags } from '@/lib/api/server';
import type { Membership } from './types';

/** `null` when the tenant's plan doesn't include memberships. */
export const getMembership = cache((tenant: string) =>
  apiGetOrNull<Membership>(tenant, '/membership', { tags: [cacheTags.membership(tenant)] }),
);
