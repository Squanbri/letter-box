import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountInput, AccountStatus, BasicAccountInput } from '../../shared/api/client';
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

export function useSaveBasicAccountMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      current,
      input,
    }: {
      current: AccountStatus | null;
      input: BasicAccountInput;
    }) => {
      if (window.letterBoxAccounts) {
        return await window.letterBoxAccounts.addBasic({
          ...input,
          accountId: current?.id,
        }).then((result) => {
          if (result && typeof result === 'object' && 'error' in result) {
            throw new Error(String((result as { error: string }).error));
          }
          return result as AccountStatus;
        });
      }
      return current ? api.reconnectAccount(current.id, input) : api.addAccount(input);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: accountKeys.all }),
  });
}

export function useDeleteAccountMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await window.letterBoxAccounts?.forgetTokens(id);
      return api.deleteAccount(id);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: accountKeys.all }),
  });
}
