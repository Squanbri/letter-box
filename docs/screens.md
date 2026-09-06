# Letter Box — Screens & Behaviour

Reference mockups: `design-reference/Letter Box.dc.html` (canvas ids `4a`, `4b`, `3a`, `3b`, `3c`, `2a`).
Design tokens: [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

Core model: **a tag section aggregates messages from all connected accounts.** Account is a filter inside a section, not a container.

## Global navigation

| Zone (left rail, 56px) | Contents | Keys |
|---|---|---|
| Screens | `⌂` Дашборд, `∗` Все письма | `⌥1`, `⌥2` |
| Tag sections | pinned tags, межаккаунтные by default | `⌥3 … ⌥9` |
| Accounts | one dot per account; click scopes the **current** section | `⌥←` `⌥→` |
| Compose | `✎` opens a **separate OS window** | `⌘N` |

Other: `⌥K` tag palette · `↑ ↓` selection · `⏎` open · `⌘⏎` send.

## Screens

1. **Дашборд (`3a`)** — matrix tag×account, 14-day flow, accounts, awaiting reply.
2. **Секция тега (`3b`/`3c`)** — full-width table or scoped; `⏎` → reader.
3. **Чтение (`2a`)** — rail 56 · list 340 · reader; thread spine.
4. **Подключение (`4a`)** — address → detect provider → app password → connect.
5. **Написание (`4b`)** — separate macOS window 1120×720; reply has thread column 264px.
6. **Все письма (`∗`)** — same as tag section without tag filter.
