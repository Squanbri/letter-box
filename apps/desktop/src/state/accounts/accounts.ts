import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountInput, AccountStatus } from '../../shared/api/client';
import { api } from '../../shared/api/client';

export const accountKeys = {
  all: ['accounts'] as const,
};

export function useAccountsQuery(enabled = true) {
  return useQuery({
    queryKey: accountKeys.all,
    queryFn: api.accounts,
    enabled,
  });
}

export function useSaveAccountMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ current, input }: { current: AccountStatus | null; input: AccountInput }) =>
      current ? api.reconnectAccount(current.id, input) : api.addAccount(input),
    onSuccess: () => client.invalidateQueries({ queryKey: accountKeys.all }),
  });
}

export function useDeleteAccountMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: () => client.invalidateQueries({ queryKey: accountKeys.all }),
  });
}
