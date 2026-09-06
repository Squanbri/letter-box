# Letter Box — слепок текущей версии

Снимок продукта **до полного редизайна**. Цель файла — зафиксировать, что умеет
приложение, как устроено и что можно убрать / изменить / добавить, не теряя
контекст.

| Поле | Значение |
| --- | --- |
| Версия пакетов | `0.1.0` |
| Коммит | `3bfd8e970d8cc575cb79379afb2c5fc5f7b3df4a` |
| Ветка | `redesign/green-theme` |
| Дата слепка | 2026-09-06 |
| Платформа клиента | macOS (Electron) |
| Лицензия | MIT |

Соседние документы:

- [Архитектура runtime](architecture.md) — границы процессов и persistence
- [Self-hosting](self-hosting.md) — Docker, Ollama, HTTPS, пароли приложений

---

## 1. Что это за продукт

Self-hosted почтовый клиент: **desktop на Mac** + **свой NestJS-сервер**.

Сервер — единственный владелец IMAP/SMTP-соединений, credentials и писем.
Desktop не ходит в почтовые провайдеры напрямую. Клиент общается с API по
REST (`/api/v1`) и Socket.IO.

Провайдеры: **Mail.ru**, **Яндекс**, **Gmail**. Нужен пароль приложения, не
обычный пароль ящика.

Опционально worker тегирует непрочитанные письма локальной моделью через
Ollama (`qwen3:0.6b` по умолчанию). Без Ollama почта работает, тегов нет.

Целевая аудитория по текущему UX: один пользователь (или мало пользователей)
на своём сервере. Первый зарегистрированный пользователь создаётся даже при
`ALLOW_REGISTRATION=false`.

---

## 2. Карта экранов и навигация

Нет URL-роутера. Навигация — вкладки в шапке окна (Chrome-like tab bar).

```text
AuthPage                         — если нет сессии
AppShell
  tabbar
    [Обзор]  pinned, всегда открыт
    [аккаунт / unified…]         — сессионные вкладки, drag-and-drop
    ☀/☾  Выйти                   — справа
  panel
    OverviewPage                 — active === 'overview'
    MailboxPage                  — вкладка аккаунта
    UnifiedInboxPage             — unified:unread | unified:tag:<tag>
  AccountDialog                  — modal: новый / переподключение
```

Холодный старт: только «Обзор». Открытые почтовые вкладки **не
восстанавливаются** после перезапуска (ключ `letter-box.open-account-tabs`
сбрасывается).

Типы вкладок:

| ID вкладки | Экран | Как открывается |
| --- | --- | --- |
| `overview` | Дашборд | Всегда, кнопка «Обзор» |
| `<accountId>` | Почта одного ящика | Клик по аккаунту на обзоре, после сохранения аккаунта |
| `unified:unread` | Единый inbox непрочитанных | Карточка «Непрочитанные» |
| `unified:tag:<tag>` | Единый inbox по AI-тегу | Карточки «Важные», пилюли AI-тегов |

Вкладки аккаунтов и unified можно закрывать (×) и переставлять drag-and-drop.
«Обзор» закрыть нельзя.

---

## 3. Возможности по экранам

Это инвентарь фич. При редизайне каждую можно оставить, перенести, упростить
или выкинуть.

### 3.1 Авторизация (`AuthPage`)

- Вход / регистрация одним экраном, переключатель режима
- Поля: email, пароль (≥ 10 символов)
- Первый пользователь регистрируется даже при `ALLOW_REGISTRATION=false`
- Сессия хранится в Electron `safeStorage` (`auth-session.bin`), не в
  localStorage
- Access JWT 15 минут, refresh 30 дней, ротация refresh, logout отзывает
  текущий refresh
- При 401 клиент пробует refresh; если не вышло — событие
  `letter-box:unauthorized` и сброс UI

### 3.2 Обзор (`OverviewPage`)

Шапка: «Добрый день», кнопки **Обновить все** и **Добавить аккаунт**.

Блоки сверху вниз:

1. **Аккаунты** (`AccountList`)
   - Карточки: статус-точка, email, провайдер, время sync, число непрочитанных
   - Клик открывает вкладку ящика
   - Switch «Авто-синхронизация» (per-account, local)
   - Переподключить / удалить (удаление с confirm)
   - Пустое состояние: Mail.ru / Яндекс / Gmail + кнопка добавить
   - Ошибка аккаунта (`lastError`) под карточкой

2. **Статистика** (`StatsGrid`) — 4 карточки
   - Непрочитанные (сумма INBOX всех аккаунтов) → unified unread
   - Важные (сумма AI-тега `important`) → unified tag
   - Аккаунты: `connected / total`
   - Последнее обновление (max `lastSyncAt`)

3. **Графики** (`DashboardCharts`) — сетка 4 карточек
   - Письма по дням (area, 30 дней, stacked по аккаунтам если >1)
   - Непрочитанные по аккаунтам (bar)
   - Письма по AI-тегам (bar, все письма INBOX)
   - Спам среди непрочитанных (donut)

4. **AI-теги** (`SmartSummaryCard`) + **Настройки синхронизации**
   (`SyncSettingsCard`)
   - Пилюли тегов (до 8), клик → unified inbox по тегу
   - Интервал фона: 5 / 15 / 30 минут
   - Switch уведомлений о новых письмах (Electron Notification)

### 3.3 Почта аккаунта (`MailboxPage`) — трёхколоночный клиент

```text
[ папки 172px ] [toggle 28px] [ список ~30% ] [ письмо 1fr ]
```

Сайдбар папок можно свернуть.

**Шапка:** название папки + email аккаунта; кнопки **Написать** и **Обновить**.

**Папки** (`MailboxSidebar`): IMAP LIST + special-use. Русские имена:

| specialUse | UI |
| --- | --- |
| `\Inbox` | Входящие ↓ |
| `\Sent` | Отправленные ↑ |
| `\Drafts` | Черновики ✎ |
| `\Junk` | Спам ! |
| `\Trash` | Корзина ⌫ |
| `\Archive` | Архив □ |
| иначе | имя папки с сервера • |

Бейдж непрочитанных; спиннер если эта папка сейчас в sync-очереди.

**Список писем** (`MessageList`):

- Страницы по 50; infinite scroll (~180px до низа)
- Если локальная страница кончилась — `POST .../mail/load-older` тянет
  метаданные старых писем с IMAP
- Непрочитанные: жирный + зелёная точка
- Flagged: ★ в теме
- Дата, сниппет `body.text` (если уже загружено), AI-теги
- Выбранная папка пишется в `localStorage` (`letter-box.mailbox.<accountId>`)
- При смене папки сбрасываются выбранное письмо и тег-фильтр

**Фильтр по AI-тегам** над списком: «Все» + теги с count > 0.

**Просмотр письма** (`MessageViewer`):

- Ленивая загрузка тела: список без body, полное письмо — отдельный GET
- HTML в sandboxed iframe (`allow-popups`); plaintext в `<pre>`
- Шапка сворачивается (▲ / ▼ + тема)
- Теги под темой
- Отправитель: имя, адрес, дата
- **Ветка диалога**: если `threadId` / `messageId` — список писем треда
  (может пересекать папки). Клик открывает письмо, при необходимости
  переключает папку
- Действия: Ответить, Переслать, Важное (IMAP `\Flagged`), Прочитано /
  Не прочитано (`\Seen`), Архив (если есть `\Archive`), Переместить
  (Select по папкам), Удалить
- Удаление: в корзину, если есть `\Trash` и письмо не уже в ней; иначе
  IMAP EXPUNGE. Из корзины — confirm «удалить окончательно»

При открытии папки сразу ставится sync этой папки в очередь.

Открытие непрочитанного письма сразу ставит `\Seen`.

### 3.4 Единый inbox (`UnifiedInboxPage`)

Две колонки (без сайдбара папок): список + письмо.

- Источник: `GET /inbox` по всем аккаунтам пользователя, mailbox=INBOX
- Режимы: `unread=true` или `tag=<tag>`
- В списке цветной акцент аккаунта + подпись email
- Действия с письмом те же (через аккаунт-владельца)
- Compose открывается от того аккаунта, чьё письмо
- «К обзору» / «Обновить»

### 3.5 Написание (`ComposeDialog`, Mantine Modal)

Режимы: новое / ответ / пересылка.

Поля UI: От (disabled), Кому, Копия (скрыта за «Добавить копию»), Тема,
текст. **BCC в UI нет**, хотя API его принимает.

- Только plaintext, HTML-редактора нет
- Ответ: `Re:`, цитата `>`, `In-Reply-To` + `References`
- Пересылка: `Fwd:` и блок «Пересланное сообщение»
- Адреса через запятую / `;`
- После отправки SMTP сервер пытается APPEND копию в `\Sent`

### 3.6 Аккаунт (`AccountDialog`)

- Провайдер: radio Mail.ru / Яндекс / Gmail
- Email + пароль приложения
- Создание: IMAP test → persist credentials + Postgres
- Переподключение: то же + `clearMailData` (локальная почта аккаунта
  сбрасывается)

---

## 4. Фоновые возможности (не экраны)

| Возможность | Где живёт | Поведение |
| --- | --- | --- |
| Фоновый sync | Desktop `SyncProvider` | Первый запуск через 10 с, далее 5/15/30 мин; skip offline и disabled аккаунты |
| Sync по кнопке | Desktop → REST enqueue | Ждёт worker до 20 минут |
| Sync папки при открытии | `MailboxPage` | Каждая смена mailbox |
| Sync списка папок | `useMailboxesQuery` | Сначала кэш Postgres, затем IMAP LIST в фоне |
| Уведомления | Desktop Notification API | Если включены и `result.added > 0` после фонового sync |
| Socket.IO | Desktop ↔ API | `sync.started/completed/failed`, `classification.completed` → invalidate queries |
| AI-теги | Worker | Батчи pending-писем; эвристика important поверх модели |
| Тема | Desktop | Light/dark, `letter-box.theme`, иначе `prefers-color-scheme` |
| Троттлинг auth | Nest Throttler | register 3/мин, login 10/мин, refresh 30/мин |

---

## 5. Чего сейчас нет

Явные пробелы — кандидаты «добавить» или то, что редизайн не должен
ожидать как существующее.

- Поиск по письмам (локальный и IMAP)
- Вложения: ни скачивание, ни отправка
- HTML-compose, подпись, черновики как сущность UI (папка `\Drafts`
  синхронизируется, но писать в неё клиент не умеет)
- BCC в форме отправки
- Контакты / автодополнение получателей
- Клавиатурные шорткаты
- URL-роутинг, deep link на письмо
- Восстановление открытых вкладок после рестарта
- Мультиселект писем, массовые действия
- Фильтры кроме AI-тега (дата, вложения, отправитель)
- Кастомные IMAP-серверы / произвольный провайдер
- Мобильный клиент (архитектура это допускает, UI нет)
- Настройки профиля пользователя, смена пароля Letter Box
- Прочитано/непрочитано пачкой, snooze, отложить
- Офлайн-режим desktop без API
- Подпись Apple / notarize (сборка `identity: null`)

---

## 6. Текущий визуальный язык (что редизайн заменит)

Не архитектура — именно UI-контракт текущей версии.

**Окно:** 1180×760, min 820×540, `titleBarStyle: hiddenInset` (traffic
lights поверх tabbar, отступ слева 82px).

**Минимальная ширина body:** 820px. Это десктопный трёхколоночный layout,
не адаптив.

**Стек UI:** React 19 + Mantine 9 + кастомный `global.css`. Mantine даёт
кнопки, модалки, инпуты, графики (`@mantine/charts` + recharts). Геометрия
шелла, вкладок, трёх колонок и email-iframe — своя.

**Палитра (зелёный акцент):**

| Токен | Light | Dark |
| --- | --- | --- |
| `--background` | `#f3f5f4` | `#101311` |
| `--surface` | `#ffffff` | `#171b18` |
| `--accent` / `--green` | `#00a63e` | `#20e070` |
| `--text-primary` | `#151a17` | `#f0f5f1` |
| `--unread-bg` | `#edfaf3` | `#152b1e` |
| `--selected-bg` | `#d5f8e1` | `#1a3527` |

Шрифт: SF Pro / `-apple-system`. Радиус карточек ~12px, контролов `sm`.

Цвета AI-тегов зашиты в `SmartSummaryCard` и `DashboardCharts`. Цвета
аккаунтов — стабильный hash UUID → 6 слотов (`accountColor.ts`).

**Иконка приложения:** `apps/desktop/build/icon.png` / `.icns`.

---

## 7. Архитектура

```text
┌─────────────────────────────────────────┐
│  Electron main                          │
│  window, safeStorage session, logs      │
│           │ preload (session IPC only)  │
│  React renderer  ──REST / Socket.IO──►  │
└─────────────────────────────────────────┘
                    │
              NestJS API  (:3000, prefix /api/v1)
                    │
     ┌──────────────┼──────────────┬──────────────┐
     │              │              │              │
 PostgreSQL     Redis/BullMQ    IMAP/SMTP     Ollama
 (истина)      очередь sync     провайдеры    (опц.)
                    │
              NestJS worker
              (тот же AppModule,
               LETTER_BOX_PROCESS_ROLE=worker)
```

Жёсткие границы:

- Desktop **никогда** не импортирует и не пакетирует NestJS
- `@letter-box/contracts` — только DTO и события, без Electron/Nest/IMAP/DB
- Credentials **не** в Postgres: AES-256-GCM файл (`credentials.json`),
  ключ `LETTER_BOX_ENCRYPTION_KEY` (SHA-256 → 32 байта)
- Сервисы ходят в БД через repository contracts, не через Prisma в
  контроллерах

Монорепо npm workspaces:

```text
apps/backend     @letter-box/server
apps/desktop     @letter-box/desktop
packages/contracts  @letter-box/contracts
```

### 7.1 Desktop: владение состоянием

| Слой | Что хранит |
| --- | --- |
| TanStack Query | Аккаунты, папки, письма, теги, stats, inbox, thread, sync status. staleTime 15s, retry 1, без refetchOnWindowFocus |
| Socket.IO | Не копия данных: только invalidate соответствующих query keys |
| React Context | Сессия, вкладки, preferences, набор syncingIds |
| Page-local state | Выбранная папка / тег / uid, compose draft, collapse sidebar/header |
| localStorage | Тема, preferences sync, активная папка аккаунта, (пишется, но сбрасывается) список вкладок |
| Electron safeStorage | JWT session JSON |

Провайдеры (порядок): DarkMode → Mantine → QueryClient → Auth → Workspace →
Preferences → Sync → AppShell.

### 7.2 Auth и владение данными

- Пользователь Letter Box ≠ почтовый аккаунт. Один user → много IMAP-ящиков
- Guard на все HTTP-роуты кроме health, register, login, refresh
- `AccountOwnershipGuard` на `/accounts/:accountId/**`
- Socket handshake: тот же JWT; события только сокетам, чьей user_id
  принадлежит `event.accountId`
- Первый зарегистрированный user забирает legacy-аккаунты без владельца

### 7.3 Sync pipeline

1. Клиент `POST /accounts/:id/mail/sync?mailbox=`
2. API кладёт BullMQ job, `jobId = sha256(accountId + mailbox)` — одинаковые
   активные jobs сливаются
3. Worker: reload credentials с диска → IMAP FETCH changes → Postgres
   applyChanges → статус аккаунта → Socket `sync.completed`
4. Retries: 3 попытки, exponential backoff от 5s
5. Timeout wait на API: 20 минут
6. IMAP UIDVALIDITY: при смене — reset известных UID

Что синкается: метаданные (envelope, flags, size, Message-ID / References).
Тело — отдельно при открытии. Для классификации IMAP ещё готовит короткий
текст (`classification_text`) у непрочитанных кандидатов.

### 7.4 AI-классификация

Worker каждые `CLASSIFY_INTERVAL_MS` (dev default 10s в compose, 30s в
`.env.example`):

1. Эвристика `important` по regex (OTP, 2FA, новый логин, смена пароля,
   дедлайны) — даже без модели
2. Батч `classification_status = pending` → Ollama JSON tags → heuristic
   overlay → запись `tags` JSON (1–3 тега) → Socket
   `classification.completed`

Теги (закрытый список):

`important`, `spam`, `promo`, `work`, `games`, `news`, `it`, `personal`,
`finance`, `other`

Правила модели: promo не important; marketing ≠ spam; important только для
кодов/безопасности/дедлайнов.

Best-effort: падение Ollama не ломает sync.

### 7.5 IMAP / SMTP endpoints

| Провайдер | IMAP | SMTP (fallback) |
| --- | --- | --- |
| Mail.ru | `imap.mail.ru:993` TLS | `smtp.mail.ru` 465 → 587 STARTTLS |
| Яндекс | `imap.yandex.ru:993` TLS | `smtp.yandex.ru` 465 → 587 |
| Gmail | `imap.gmail.com:993` TLS | `smtp.gmail.com` 587 → 465 |

Яндекс: SMTP/IMAP username = local-part для `yandex.ru` / `ya.ru`.
Gmail: пробелы в пароле приложения вырезаются. Транспорт IPv4-only
(`family: 4`) из-за Docker/macOS IPv6.

Треды: `threadId = first(References) || In-Reply-To || Message-ID`
(нормализованный `<id>`).

---

## 8. Модель данных (PostgreSQL / Prisma)

```text
users
  id uuid PK
  email unique
  password_hash   scrypt$salt$hash
  created_at, updated_at
  → accounts, auth_sessions

accounts
  id uuid PK
  user_id uuid? FK users ON DELETE CASCADE
  provider, email
  status  connected | disconnected | syncing | error
  last_error, last_sync_at
  → mailbox_state, mailboxes, messages

mailbox_state
  (account_id, mailbox) PK
  uid_validity

mailboxes
  (account_id, path) PK
  name, delimiter, special_use
  total_count, unread_count, listed_at

messages
  (account_id, mailbox, uid) PK
  subject, sender_name, sender_address, received_at
  flags JSON, size
  body_text, body_html, body_loaded_at     — lazy
  classification_text, classification_status, classified_at
  tags JSON default []
  message_id, in_reply_to, references_header, thread_id

auth_sessions
  id uuid PK
  user_id FK
  token_hash unique   SHA-256 refresh
  expires_at
```

Индексы messages: `(account, mailbox, received_at DESC, uid DESC)`,
classification_status, message_id, thread_id.

Миграции: SQL history в `schema_migrations` + Prisma schema. Direct `pg`
только для bootstrap истории миграций.

**Не в БД:** пароли IMAP (файл credentials), JWT access (клиент),
preferences и тема (localStorage).

---

## 9. REST API (`/api/v1`)

Все кроме помеченных `@Public` требуют `Authorization: Bearer <access>`.

### Auth

| Метод | Путь | Примечание |
| --- | --- | --- |
| POST | `/auth/register` | public, throttle 3/min |
| POST | `/auth/login` | public, throttle 10/min |
| POST | `/auth/refresh` | public, body `{ refreshToken }` |
| POST | `/auth/logout` | 204, отзывает refresh |

### Accounts

| Метод | Путь |
| --- | --- |
| GET | `/accounts` |
| POST | `/accounts` |
| PUT | `/accounts/:accountId` |
| DELETE | `/accounts/:accountId` |
| POST | `/accounts/:accountId/imap/connect` |

### Mail (все под `AccountOwnershipGuard`)

| Метод | Путь | Смысл |
| --- | --- | --- |
| POST | `.../mail/sync?mailbox=` | enqueue + wait |
| GET | `.../mail/sync` | какие mailbox сейчас в очереди |
| GET | `.../mailboxes` | из Postgres |
| POST | `.../mailboxes/sync` | IMAP LIST → Postgres |
| GET | `.../messages?mailbox&offset&limit&tag` | список без body, limit ≤ 100 |
| GET | `.../messages/:uid?mailbox=` | + lazy body |
| GET | `.../messages/:uid/thread` | все письма threadId |
| POST | `.../messages/send` | SMTP |
| PATCH | `.../messages/:uid/seen` | `{ seen }` |
| PATCH | `.../messages/:uid/flagged` | `{ flagged }` |
| POST | `.../messages/:uid/move` | `{ destination }` |
| POST | `.../messages/:uid/archive` | в `\Archive` |
| DELETE | `.../messages/:uid` | trash или expunge |
| GET | `.../mail/tags?mailbox=` | counts |
| POST | `.../mail/load-older?mailbox&beforeUid` | IMAP metadata chunk |

### Cross-account

| Метод | Путь |
| --- | --- |
| GET | `/inbox?mailbox&unread&tag&offset&limit` |
| GET | `/stats?days&mailbox` | days 1–90, default 30 |

### Infra

| Метод | Путь |
| --- | --- |
| GET | `/health`, `/health/live` | процесс жив |
| GET | `/health/ready` | Postgres + Redis + ≥1 worker |
| POST | `/diagnostics/log` | логи renderer на сервер |

### Socket.IO

Событие `server.event`, payload `ServerEvent`:

```ts
{ type: 'sync.started', accountId, mailbox }
{ type: 'sync.completed', accountId, mailbox, result }
{ type: 'sync.failed', accountId, mailbox, error }
{ type: 'classification.completed', accountId, mailbox, uid, tags }
```

`SyncResult`: `{ synced, added, updated, removed }`.

Клиентский URL API: query `?api=` или `LETTER_BOX_API_URL`, иначе
`http://127.0.0.1:3000`.

---

## 10. Контракты (`packages/contracts`)

Общие типы, которые нельзя ломать, не трогая оба приложения:

- `MailProvider`, `AccountConnectionStatus`, `AccountInput`, `AccountStatus`
- `AuthCredentials`, `AuthUser`, `AuthSession`
- `MessageRecord`, `MailboxRecord`
- `SendMessageInput` / `SendMessageResult` (to/cc/bcc, inReplyTo, references)
- `DashboardStats`, `SyncResult`, `SyncStatus`
- `MESSAGE_TAGS`, `MESSAGE_TAG_LABELS` (русские подписи)
- `ServerEvent`

`MessageRecord.body` в списках обычно `null`; заполняется в GET одного письма.

---

## 11. Клиентское хранилище (local / Electron)

| Ключ / путь | Содержимое |
| --- | --- |
| Electron `userData/auth-session.bin` | encrypted JSON сессии |
| Electron `userData/logs/main.log` | логи main process |
| `letter-box.theme` | `light` \| `dark` |
| `letter-box.background-sync` | `{ intervalMinutes, disabledAccountIds, notifications }` |
| `letter-box.mailbox.<accountId>` | выбранный IMAP path |
| `letter-box.open-account-tabs` | пишется, на старте удаляется |
| `letter-box.active-tab` | пишется, на старте игнорируется |

Сервер: `CREDENTIALS_PATH` (default `./data/credentials.json`), Docker volume
`letter_box_server`.

---

## 12. Карта файлов UI (что трогать при редизайне)

Почти весь визуал живёт здесь. Backend и contracts менять только если фича
меняется по смыслу.

```text
apps/desktop/src/
  App.tsx
  app/
    AppShell.tsx          вкладки, logout, theme toggle, роутинг панелей
    AppProviders.tsx
    theme.ts              Mantine theme (brand green)
    global.css            шелл, обзор, почта, теги, тёмная тема
    darkMode.ts
  pages/
    auth/AuthPage.tsx
    overview/OverviewPage.tsx
      components/ AccountList, StatsGrid, DashboardCharts,
                  SmartSummaryCard, SyncSettingsCard
    mailbox/MailboxPage.tsx
      components/ MailboxSidebar, MessageList, MessageViewer, ComposeDialog
    inbox/UnifiedInboxPage.tsx
  components/account-dialog/AccountDialog.tsx
  state/                  auth, accounts, mail, sync, preferences, workspace
  shared/
    api/client.ts
    lib/ format, email-html, accountColor, notifications
    ui/AsyncState.tsx
apps/desktop/electron/
  main.ts, preload.ts, session-store.ts, logger.ts
```

Backend трогать не обязательно для «просто нового UI». Трогать придётся,
если редизайн добавляет поиск, вложения, BCC-форму с валидацией, другой
inbox-фильтр и т.д.

---

## 13. Команды и инфраструктура

```bash
npm run infra:up     # Postgres 17 + Redis 7
npm run dev          # api + worker + desktop
npm run server:up    # docker: server + worker + deps
npm test             # backend tests
npm run typecheck
npm run dist:mac     # .app / .dmg без подписи
```

Node ≥ 22. Compose: `server`, `worker`, `postgres`, `redis`. Ollama обычно
на хосте, worker в Docker ходит на `host.docker.internal:11434`.

Ключевые env: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`,
`LETTER_BOX_ENCRYPTION_KEY`, `ALLOW_REGISTRATION`, `LETTER_BOX_API_URL`,
`OLLAMA_*`, `CLASSIFY_*`, `SYNC_WORKER_CONCURRENCY`.

---

## 14. Чеклист для редизайна

Использовать как инвентарь: напротив каждой строки — оставить / перенести /
упростить / удалить / заменить новой фичей.

**Навигация и шелл**

- [ ] Tab bar с pinned «Обзор»
- [ ] Вкладки аккаунтов с unread badge
- [ ] Unified-вкладки (непрочитанные / тег)
- [ ] Drag-and-drop порядка вкладок
- [ ] Закрытие вкладки без удаления аккаунта
- [ ] Theme toggle в шапке
- [ ] Logout
- [ ] macOS hiddenInset + отступ под traffic lights
- [ ] Минимальная ширина ~820px / трёхколоночность

**Обзор**

- [ ] Список аккаунтов со статусом и unread
- [ ] Авто-синхронизация per account
- [ ] Переподключение / удаление аккаунта
- [ ] Карточки непрочитанные / важные / connected / last sync
- [ ] 4 графика
- [ ] Пилюли AI-тегов
- [ ] Интервал sync 5/15/30
- [ ] Desktop-уведомления

**Почта**

- [ ] Сайдбар папок + collapse
- [ ] Infinite scroll + load-older
- [ ] Фильтр списка по AI-тегу
- [ ] Ленивое тело письма
- [ ] HTML sandbox iframe
- [ ] Сворачиваемая шапка письма
- [ ] Треды
- [ ] Seen / Flagged / Move / Archive / Delete
- [ ] Compose: new / reply / forward, CC
- [ ] Единый inbox unread
- [ ] Единый inbox по тегу
- [ ] Цвета аккаунтов в unified-списке

**Аккаунты и auth**

- [ ] Login / register
- [ ] Три провайдера + пароль приложения
- [ ] Фоновый sync не привязан к открытой вкладке

**Не реализовано — решать отдельно**

- [ ] Поиск
- [ ] Вложения
- [ ] HTML compose / подпись / черновики
- [ ] BCC UI
- [ ] Шорткаты
- [ ] Восстановление вкладок
- [ ] Массовые действия
- [ ] Произвольный IMAP

---

## 15. Что редизайн не должен сломать без явного решения

1. Сервер остаётся владельцем IMAP и credentials
2. JWT + refresh rotation + ownership аккаунтов
3. Ленивое тело письма (иначе раздуется Postgres и sync)
4. Очередь sync в worker, а не в UI-процессе
5. AI как optional overlay, не как зависимость чтения почты
6. Контракты в `@letter-box/contracts` — общий язык клиента и сервера
7. Пароли приложений и AES-GCM файл credentials

Если меняется только UI: можно заменить Mantine, CSS, шелл, навигацию и
композицию экранов, сохранив `shared/api/client.ts` и query keys.
