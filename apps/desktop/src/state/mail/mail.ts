import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { Message } from '../../shared/api/client';
import { api } from '../../shared/api/client';
import { accountKeys } from '../accounts/accounts';

const PAGE_SIZE = 50;

export const mailKeys = {
  all: ['mail'] as const,
  mailboxes: (accountId: string) => ['mail', accountId, 'mailboxes'] as const,
  messages: (accountId: string, mailbox: string) =>
    ['mail', accountId, 'messages', mailbox] as const,
  message: (accountId: string, mailbox: string, uid: number) =>
    ['mail', accountId, 'message', mailbox, uid] as const,
  syncStatus: (accountId: string) => ['mail', accountId, 'sync-status'] as const,
};

export function useMailboxesQuery(accountId: string) {
  const client = useQueryClient();
  return useQuery({
    queryKey: mailKeys.mailboxes(accountId),
    queryFn: async () => {
      const stored = await api.mailboxes(accountId);
      void api.syncMailboxes(accountId).then((mailboxes) => {
        client.setQueryData(mailKeys.mailboxes(accountId), mailboxes);
      }).catch(() => undefined);
      return stored;
    },
  });
}

export function useMessagesQuery(accountId: string, mailbox: string) {
  const client = useQueryClient();
  return useInfiniteQuery({
    queryKey: mailKeys.messages(accountId, mailbox),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let page = await api.messages(accountId, mailbox, pageParam, PAGE_SIZE);
      if (pageParam > 0 && page.length === 0) {
        const existing = client.getQueryData<{ pages: Message[][] }>(
          mailKeys.messages(accountId, mailbox),
        );
        const messages = existing?.pages.flat() ?? [];
        const beforeUid = messages.length
          ? Math.min(...messages.map((message) => message.uid))
          : undefined;
        const loaded = await api.loadOlder(accountId, mailbox, beforeUid);
        if (loaded.loaded > 0) {
          page = await api.messages(accountId, mailbox, pageParam, PAGE_SIZE);
        }
      }
      return page;
    },
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === PAGE_SIZE ? pages.flat().length : undefined,
  });
}

export function useMessageQuery(
  accountId: string,
  mailbox: string,
  uid: number | null,
) {
  return useQuery({
    queryKey: mailKeys.message(accountId, mailbox, uid ?? 0),
    queryFn: () => api.message(accountId, uid!, mailbox),
    enabled: uid !== null,
  });
}

export function useSyncStatusQuery(accountId: string) {
  return useQuery({
    queryKey: mailKeys.syncStatus(accountId),
    queryFn: () => api.syncStatus(accountId),
    refetchInterval: 5_000,
  });
}

function updateMessageFlags(
  client: ReturnType<typeof useQueryClient>,
  accountId: string,
  mailbox: string,
  uid: number,
  flags: string[],
) {
  client.setQueryData(
    mailKeys.messages(accountId, mailbox),
    (current: { pages: Message[][]; pageParams: unknown[] } | undefined) =>
      current ? {
        ...current,
        pages: current.pages.map((page) => page.map((message) =>
          message.uid === uid ? { ...message, flags } : message,
        )),
      } : current,
  );
  client.setQueryData(
    mailKeys.message(accountId, mailbox, uid),
    (current: Message | undefined) => current ? { ...current, flags } : current,
  );
}

export function useMessageActions(accountId: string) {
  const client = useQueryClient();
  const refresh = (mailbox: string) => Promise.all([
    client.invalidateQueries({ queryKey: mailKeys.messages(accountId, mailbox) }),
    client.invalidateQueries({ queryKey: mailKeys.mailboxes(accountId) }),
    client.invalidateQueries({ queryKey: accountKeys.all }),
  ]);

  const seen = useMutation({
    mutationFn: ({ message, value }: { message: Message; value: boolean }) =>
      api.setSeen(accountId, message.uid, value, message.mailbox),
    onMutate: ({ message, value }) => {
      const flags = value
        ? [...new Set([...message.flags, '\\Seen'])]
        : message.flags.filter((flag) => flag !== '\\Seen');
      updateMessageFlags(client, accountId, message.mailbox, message.uid, flags);
    },
    onSettled: (_data, _error, { message }) => refresh(message.mailbox),
  });

  const flagged = useMutation({
    mutationFn: ({ message, value }: { message: Message; value: boolean }) =>
      api.setFlagged(accountId, message.uid, value, message.mailbox),
    onMutate: ({ message, value }) => {
      const flags = value
        ? [...new Set([...message.flags, '\\Flagged'])]
        : message.flags.filter((flag) => flag !== '\\Flagged');
      updateMessageFlags(client, accountId, message.mailbox, message.uid, flags);
    },
    onSettled: (_data, _error, { message }) => refresh(message.mailbox),
  });

  const move = useMutation({
    mutationFn: ({ message, destination }: { message: Message; destination: string }) =>
      api.moveMessage(accountId, message.uid, message.mailbox, destination),
    onSuccess: (_data, { message, destination }) => Promise.all([
      refresh(message.mailbox),
      refresh(destination),
    ]),
  });

  const archive = useMutation({
    mutationFn: (message: Message) =>
      api.archiveMessage(accountId, message.uid, message.mailbox),
    onSuccess: (_data, message) => refresh(message.mailbox),
  });

  const remove = useMutation({
    mutationFn: (message: Message) =>
      api.deleteMessage(accountId, message.uid, message.mailbox),
    onSuccess: (_data, message) => refresh(message.mailbox),
  });

  return { seen, flagged, move, archive, remove };
}
