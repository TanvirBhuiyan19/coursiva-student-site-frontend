'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { PartnerApplication, PartnerApplicationInput, PartnerProgram } from './types';

export function usePartnerProgram() {
  return useQuery({ queryKey: ['partners', 'program'], queryFn: () => api.get<PartnerProgram>('/affiliates/program') });
}

export function useApplyAsPartner() {
  return useMutation({
    mutationFn: (input: PartnerApplicationInput) => api.post<PartnerApplication>('/affiliates/applications', input),
    meta: { errorToast: false },
  });
}
