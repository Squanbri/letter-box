repo: Squanbri/letter-box
branch: main
path: apps/desktop/src

## Last sync
date: 2026-09-05T21:20:00Z

### Updated in this project
- Полный редизайн десктоп-клиента: теги как основная навигация (агрегация писем из всех аккаунтов)
- Убраны табы аккаунтов и второй сайдбар; строка письма — одна строка 32px
- Читалка занимает ~2/3 окна, добавлена ветвь диалога (тред с ветвлением)
- Палитра переходов по тегам (⌥K) со счётчиками по каждому аккаунту

## Screen map
| Экран проекта | Файлы репозитория |
| --- | --- |
| Letter Box.dc.html — главное окно (2A) | apps/desktop/src/app/AppShell.tsx, apps/desktop/src/pages/mailbox/MailboxPage.tsx, apps/desktop/src/pages/mailbox/components/MessageList.tsx, apps/desktop/src/pages/mailbox/components/MailboxSidebar.tsx |
| Letter Box.dc.html — читалка и ветвь диалога | apps/desktop/src/pages/mailbox/components/MessageViewer.tsx |
| Letter Box.dc.html — палитра тегов (⌥K) | packages/contracts/src/index.ts (MESSAGE_TAGS), apps/desktop/src/pages/overview/components/SmartSummaryCard.tsx |
| Цвета аккаунтов, тема | apps/desktop/src/shared/lib/accountColor.ts, apps/desktop/src/app/theme.ts |
