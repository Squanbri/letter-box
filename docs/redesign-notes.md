# Letter Box — notes for redesign branch

Reference mockup lives in `docs/design-reference/` (Claude Design export).

## Navigation model (replaces account tabs)

- Left rail 56px: dashboard ⌥1, all mail ⌥2, unread, primary tags ⌥3–⌥9
- Tag palette ⌥K with per-account counters
- Account scope chips + ⌥←/→
- No Chrome-like account tabs, no IMAP folder sidebar in primary UX

## Dashboard

- Tag × account matrix (open tag row / single cell)
- One 14-day stacked flow chart (not four chart cards)
- Slim accounts list + awaiting-reply (Seen && !Answered)
- Sync interval + notifications kept in a compact card

## Mail section

- Compact 32px rows; full-width table when nothing selected
- Open message → list collapses to 340px, reader takes the rest
- Actions, threads, compose retained from previous client
