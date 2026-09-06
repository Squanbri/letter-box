import type { ComposeState } from '../../pages/mailbox/components/ComposeDialog';

/** Opens a dedicated Electron compose window. Returns false when falling back to in-app UI. */
export async function openComposeWindow(state: ComposeState): Promise<boolean> {
  if (!window.letterBoxCompose?.open) return false;
  await window.letterBoxCompose.open({
    accountId: state.accountId,
    draft: state.draft,
    thread: state.thread ?? null,
    tagHint: state.tagHint ?? null,
  });
  return true;
}

export async function loadComposePayload(id: string): Promise<ComposeState | null> {
  const payload = await window.letterBoxCompose?.load(id);
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Partial<ComposeState>;
  if (!value.accountId || !value.draft) return null;
  return {
    accountId: value.accountId,
    draft: value.draft,
    thread: value.thread,
    tagHint: value.tagHint,
  };
}
