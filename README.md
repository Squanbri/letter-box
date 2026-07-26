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

Запустите Electron со встроенным backend:

```bash
npm run dev
```

При первом запуске выберите Mail.ru или Яндекс, введите адрес и пароль
приложения. Приложение проверит IMAP-подключение, сохранит пароль в
зашифрованном виде через macOS Keychain, синхронизирует `INBOX` и покажет
локальный список писем.

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

## REST API

| Метод | Путь | Назначение |
| --- | --- | --- |
| `GET` | `/health` | Проверка доступности backend |
| `GET` | `/account` | Состояние подключённого аккаунта |
| `POST` | `/account` | Проверка и безопасное сохранение аккаунта |
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
