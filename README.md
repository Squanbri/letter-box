# Letter Box

Desktop-почтовый клиент для macOS с несколькими аккаунтами Mail.ru и Яндекса.
Приложение синхронизирует `INBOX` и хранит письма локально в SQLite.

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

Запустите Electron со встроенным backend:

```bash
npm run dev
```

На вкладке «Обзор» можно добавлять, переподключать и явно удалять аккаунты.
Каждый аккаунт открывается в отдельной вкладке; открытые вкладки
восстанавливаются после перезапуска. Закрытие вкладки не удаляет аккаунт.

Конфигурация через `.env` по-прежнему поддерживается для отладки backend без
Electron. Файл `.env` исключён из Git.

## macOS-установщик

Соберите неподписанные `.app` и `.dmg`:

```bash
npm run dist:mac
```

Результат появится в `apps/desktop/dist/`. Такой `.dmg` подходит для локальной
установки и тестирования. Для распространения другим пользователям потребуются
Apple Developer ID, code signing и notarization.

Backend входит в Electron-приложение и автоматически запускается на свободном
локальном порту. База и зашифрованные настройки хранятся в:

```text
~/Library/Application Support/Letter Box/
```

Диагностический лог main process, встроенного backend и ошибок renderer:

```text
~/Library/Application Support/Letter Box/logs/main.log
```

Лог автоматически ротируется после 2 МБ, предыдущая версия сохраняется рядом
как `main.log.previous`. Пароль приложения и тела HTTP-запросов в лог не
записываются.

## REST API

| Метод | Путь | Назначение |
| --- | --- | --- |
| `GET` | `/health` | Проверка доступности backend |
| `GET` | `/accounts` | Список аккаунтов и их статусы |
| `POST` | `/accounts` | Проверка и добавление аккаунта |
| `PUT` | `/accounts/:accountId` | Переподключение аккаунта |
| `DELETE` | `/accounts/:accountId` | Удаление аккаунта, credentials и локальной почты |
| `POST` | `/accounts/:accountId/imap/connect` | Проверка IMAP-подключения |
| `POST` | `/accounts/:accountId/mail/sync` | Синхронизация `INBOX` аккаунта |
| `GET` | `/accounts/:accountId/messages?mailbox=INBOX` | Локальный список писем |
| `GET` | `/accounts/:accountId/messages/:uid?mailbox=INBOX` | Письмо с ленивой загрузкой тела |

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
