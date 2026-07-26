import { Badge, Loader } from '@mantine/core';
import type { MailboxInfo } from '../../../shared/api/client';
import { formatCount, mailboxDisplayName, mailboxIcon } from '../../../shared/lib/format';

export function MailboxSidebar({
  mailboxes,
  selected,
  syncing,
  onSelect,
}: {
  mailboxes: MailboxInfo[];
  selected: string;
  syncing: Set<string>;
  onSelect: (mailbox: string) => void;
}) {
  return (
    <aside className="mailbox-list" aria-label="Почтовые папки">
      {mailboxes.map((mailbox) => (
        <button
          key={mailbox.path}
          className={selected === mailbox.path ? 'selected' : ''}
          onClick={() => onSelect(mailbox.path)}
          title={mailbox.path}
        >
          <span>{mailboxIcon(mailbox.specialUse)}</span>
          <strong>{mailboxDisplayName(mailbox)}</strong>
          {syncing.has(mailbox.path)
            ? <span className="mailbox-spinner"><Loader size={13} /></span>
            : mailbox.unreadCount > 0 && <Badge size="xs">{formatCount(mailbox.unreadCount)}</Badge>}
        </button>
      ))}
    </aside>
  );
}
