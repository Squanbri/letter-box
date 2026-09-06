import { Modal } from '@mantine/core';
import { MESSAGE_TAGS, type MessageTag } from '@letter-box/contracts';
import type { AccountStatus } from '../../shared/api/client';
import { accountColor } from '../../shared/lib/accountColor';
import { tagLabel } from '../../shared/lib/format';
import { tagColor } from '../../shared/lib/tagColor';
import { useDashboardStatsQuery } from '../../state/mail/mail';

export function TagPalette({
  opened,
  accounts,
  onClose,
  onSelect,
}: {
  opened: boolean;
  accounts: AccountStatus[];
  onClose: () => void;
  onSelect: (tag: MessageTag, accountId?: string | null) => void;
}) {
  const statsQuery = useDashboardStatsQuery(14, opened);
  const matrix = statsQuery.data?.tagAccountMatrix ?? [];
  const unreadByTag = new Map((statsQuery.data?.unreadByTag ?? []).map((row) => [row.tag, row.count]));
  const totalByTag = new Map((statsQuery.data?.messagesByTag ?? []).map((row) => [row.tag, row.count]));

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Переход между тегами"
      size="lg"
      centered
      className="tag-palette-modal"
    >
      <p className="tag-palette-hint">⌥K · счётчики по всем аккаунтам</p>
      <div className="tag-palette-grid">
        {MESSAGE_TAGS.map((tag) => {
          const unread = unreadByTag.get(tag) ?? 0;
          const total = totalByTag.get(tag) ?? 0;
          return (
            <div className="tag-palette-row" key={tag}>
              <button
                type="button"
                className="tag-palette-main"
                onClick={() => onSelect(tag, null)}
              >
                <span className="tag-dot" style={{ background: tagColor(tag) }} />
                <span className="tag-palette-name">{tagLabel(tag)}</span>
                <span className="tag-palette-count">
                  {total}
                  {unread > 0 ? ` · ${unread} непроч.` : ''}
                </span>
              </button>
              <div className="tag-palette-accounts">
                {accounts.map((account) => {
                  const cell = matrix.find(
                    (row) => row.tag === tag && row.accountId === account.id,
                  );
                  const count = cell?.count ?? 0;
                  const color = accountColor(account.id);
                  return (
                    <button
                      type="button"
                      key={account.id}
                      className="tag-palette-account"
                      disabled={count === 0}
                      title={account.email}
                      onClick={() => onSelect(tag, account.id)}
                    >
                      <span className="account-dot" style={{ background: color.accent }} />
                      <span>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
