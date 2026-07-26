# Letter Box

Минимальный desktop-почтовый клиент для macOS. На текущем этапе приложение
работает с одним IMAP-аккаунтом, синхронизирует только `INBOX` и хранит письма
локально в SQLite.

## Архитектура

```text
Electron + React ──REST──> NestJS ──> SQLite
                              │
                              └────> IMAP (imapflow)
```

Renderer Electron не имеет доступа к Node.js и IMAP. Все операции выполняются
через REST API backend.

При синхронизации в SQLite сохраняются UID, тема, отправитель, дата, флаги и
размер. Тело письма запрашивается с IMAP и сохраняется только при первом
открытии письма.

## Запуск

Требования:

- macOS;
- Node.js 22 или новее;
- пароль приложения Mail.ru или Яндекса.

Установите зависимости:

```bash
npm install
```

Создайте локальный файл конфигурации:

```bash
cp .env.example .env
```

Заполните в `.env` адрес, логин и пароль приложения. Для Яндекса замените
`IMAP_HOST` на `imap.yandex.ru`. Файл `.env` исключён из Git.

Запустите backend и Electron одним процессом разработки:

```bash
npm run dev
```

После запуска нажмите **Обновить**. Приложение проверит IMAP-подключение,
синхронизирует `INBOX` и покажет локальный список писем.

## REST API

| Метод | Путь | Назначение |
| --- | --- | --- |
| `GET` | `/health` | Проверка доступности backend |
| `POST` | `/imap/connect` | Проверка IMAP-подключения |
| `POST` | `/mail/sync` | Синхронизация метаданных `INBOX` |
| `GET` | `/messages` | Локальный список писем |
| `GET` | `/messages/:uid` | Письмо с ленивой загрузкой тела |

API слушает только `127.0.0.1:3000`.

## Проверки

```bash
npm run typecheck
npm run build
npm audit --omit=dev
```

## Структура

```text
apps/
  backend/   NestJS, SQLite, imapflow
  desktop/   Electron, React, Vite
```

