# Letter Box

Клиент-серверный почтовый клиент для macOS с self-hosted backend.
Синхронизирует Mail.ru, Яндекс и Gmail по IMAP/SMTP, хранит почту в
PostgreSQL и опционально размечает непрочитанные письма локальной моделью
через [Ollama](https://ollama.com).

Desktop (Electron + React) общается с NestJS по REST и Socket.IO.
Сервер — единственный владелец IMAP-соединений, credentials и данных.

## Возможности

- Несколько почтовых аккаунтов с вкладками и единым inbox по непрочитанным / AI-тегам
- Синхронизация папок: Входящие, Отправленные, Черновики, Спам, Корзина, Архив и пользовательские
- Ленивая загрузка тела письма, постраничный scroll истории
- Отправка, ответ, пересылка через SMTP; флаги «прочитано» / «важное», архив, перемещение, удаление
- Фоновая sync-очередь (BullMQ + Redis), не привязанная к жизни UI
- JWT-аутентификация с ротацией refresh-токенов
- Локальные AI-теги для непрочитанных писем через Ollama (`qwen3:0.6b` по умолчанию)
- Дашборд: непрочитанные, спам, динамика, теги, активность по аккаунтам

## Стек

| Слой | Технологии |
| --- | --- |
| Desktop | Electron, React 19, Vite, Mantine, TanStack Query, Socket.IO client |
| Backend | NestJS, Prisma, PostgreSQL, Redis, BullMQ, imapflow, nodemailer |
| AI | Ollama (локальный LLM) |
| Contracts | `@letter-box/contracts` — общие DTO и события |

```text
Electron + React ──REST / Socket.IO──> NestJS API
                                          ├──> PostgreSQL
                                          ├──> Redis / BullMQ
                                          ├──> sync worker
                                          ├──> IMAP / SMTP
                                          └──> Ollama (опционально)
```

## Требования

- **macOS** — для desktop-клиента
- **Node.js 22+**
- **Docker** — PostgreSQL и Redis (и полный server stack)
- **Ollama** — опционально, для AI-тегов
- Пароль приложения Mail.ru / Яндекс / Google

## Быстрый старт (локально)

```bash
git clone https://github.com/Squanbri/letter-box.git
cd letter-box
cp .env.example .env
npm install
```

В `.env` задайте стойкие `LETTER_BOX_ENCRYPTION_KEY` и `JWT_SECRET`
перед любым запуском вне localhost.

Поднимите инфраструктуру и всё приложение:

```bash
npm run infra:up          # PostgreSQL + Redis в Docker
npm run dev               # API + sync worker + desktop
```

Первый пользователь регистрируется в UI даже при
`ALLOW_REGISTRATION=false`. Дальнейшая регистрация — только если
явно разрешить.

### Ollama (опционально)

```bash
# macOS: приложение с https://ollama.com
# Linux: curl -fsSL https://ollama.com/install.sh | sh

ollama pull qwen3:0.6b
```

По умолчанию worker ходит на `http://127.0.0.1:11434`.
Чтобы отключить AI: `OLLAMA_ENABLED=false`.

## Развёртывание на своём сервере

Кратко:

```bash
cp .env.example .env
# задайте LETTER_BOX_ENCRYPTION_KEY, JWT_SECRET, API_HOST=0.0.0.0
docker compose up -d --build
```

Desktop укажите на сервер:

```bash
LETTER_BOX_API_URL=https://mail.example.com npm run dist:mac
```

Полная инструкция (Docker, Ollama, HTTPS, пароли приложений,
чеклист безопасности): **[docs/self-hosting.md](docs/self-hosting.md)**.

## Команды

| Команда | Назначение |
| --- | --- |
| `npm run infra:up` | PostgreSQL + Redis |
| `npm run server:up` | API + worker (+ зависит от Postgres/Redis) |
| `npm run dev` | API + worker + desktop |
| `npm run db:studio` | Prisma Studio |
| `npm run db:generate` | Prisma Client после смены schema |
| `npm test` | тесты backend |
| `npm run typecheck` | проверка типов |
| `npm run build` | сборка server + desktop |
| `npm run dist:mac` | `.app` / `.dmg` (без подписи Apple) |

## Структура

```text
apps/
  backend/     NestJS API и sync worker
  desktop/     Electron + React
packages/
  contracts/   общие DTO и Socket.IO-события
docs/
  architecture.md   границы runtime и модель данных
  self-hosting.md   запуск на своём сервере + Ollama
```

## Документация

- [Архитектура](docs/architecture.md)
- [Self-hosting и Ollama](docs/self-hosting.md)

## Лицензия

[MIT](LICENSE)
