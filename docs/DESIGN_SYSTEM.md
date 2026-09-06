# Letter Box — Design System

Desktop mail client (Electron + React). macOS-only, light theme only.
Aesthetic: warm paper ground, ink-on-paper typography, mono for all metadata.
No cards-in-cards, no shadows inside the window, no gradients, no emoji, no icon library — glyphs are typographic characters.

See also: [screens.md](screens.md), [design-reference/](design-reference/).

---

## 1. Design principles

1. **Tags are the primary navigation, not accounts.** A tag section aggregates mail from every connected account. Account is a *filter within* a section, never a tab.
2. **Maximum room for content.** One rail (56px) + one list (340px) + reader. No second sidebar, no account tabs, no persistent header bar. The reader owns ~2/3 of the window.
3. **One row = one line.** A message row is 32px tall: unread dot, account dot, sender, subject + grey snippet, time. Never a multi-line card.
4. **Metadata is mono, content is sans.** Counts, timestamps, addresses, statuses, labels → IBM Plex Mono. Subjects and body → IBM Plex Sans.
5. **Local-first is visible.** Sync/AI state is always shown as plain text with a counter (`178 / 214`), never as a spinner with no number.
6. **Separation by 1px rules, not by elevation.** Elevation only for real OS windows (main window, compose window, ⌥K palette).

---

## 2. Color

### Ground & surfaces
| Token | Hex | Use |
|---|---|---|
| `desk` | `#e7e6e2` | canvas behind the app window |
| `window` | `#fbfaf7` | window body, reader background |
| `surface` | `#fffefb` | message list, cards, inputs, reader body |
| `rail` | `#f1eee6` | left rail, window titlebar, hero panel |
| `sunken` | `#f7f5f0` | compose thread-context column |
| `chip` | `#f2efe6` | chips, pills, selected row |
| `footer` | `#faf8f2` | panel footers, status strips |
| `row-selected` | `#f7f5ee` | selected row in a full-width table |

### Borders
| Token | Hex |
|---|---|
| `border-window` | `#d7d3c8` |
| `border-strong` | `#cfc9b8` |
| `border-rail` | `#e3dfd4` |
| `border-card` | `#e6e1d4` |
| `border-section` | `#eae6da` |
| `border-row` | `#f0ece0` |
| `border-list` | `#f4f1e7` |
| `border-input` | `#ddd8ca` |

### Ink
| Token | Hex |
|---|---|
| `ink` | `#17150f` |
| `ink-body` | `#2c2920` |
| `ink-2` | `#5c584d` |
| `ink-3` | `#6b6659` |
| `ink-muted` | `#8d887a` |
| `ink-faint` | `#a9a496` |
| `ink-disabled` | `#c9c3b2` |

### Accent
`accent #1f7a4d` on `accent-bg #e4efe7`.

### Account colors
`#2774e6` · `#d63e83` · `#7c4ddb` · `#1f7a4d` · `#a06a08` · `#006d87` — 7px dots or 3px left bar only.

### Tag colors
| Tag | Ink | Bg |
|---|---|---|
| Важные | `#b3421c` | `#f6e8e1` |
| Работа | `#1550b0` | `#e8eef8` |
| Финансы | `#1f7a4d` | `#e4efe7` |
| Акции | `#a06a08` | `#f6efdd` |
| Личное | `#a02862` | `#f8e9f0` |
| IT | `#006d87` | `#e7f1f4` |
| Игры | `#5a30b0` | `#f1ecfb` |

Tag mark = 8px square, `border-radius: 2–3px`.

---

## 3. Typography

```
Sans:  'IBM Plex Sans', system-ui, sans-serif
Mono:  'IBM Plex Mono', monospace
```

Unread rows: sender 700, subject 600, ink `#17150f`. Read: 400, ink `#5c584d`.
Every uppercase label is mono + letter-spacing ≥ .06em.

---

## 4. Metrics

| Token | Value |
|---|---|
| Window | 1440×900, radius 11 |
| Rail width | 56 |
| Rail tile | 34×34, radius 10 |
| Message list (reader open) | 340 |
| Message row height | 32 / 34 full-width |
| Compose window | 1120×720 |
| Radii | 6 · 7–8 · 9–10 · 11–12 · 99 pills |

---

## 5–8

See full component / motion / iconography / a11y notes in the product design handoff.
Glyphs only: `⌂ ∗ ₽ ! ▤ ‹› % ♡ + ↓ ↑ ✎ □ ⌫ ★ ↪ ↗ ✕ ▾ ›`.
Motion: only `lbspin`. No slide-ins, no skeleton shimmer.
