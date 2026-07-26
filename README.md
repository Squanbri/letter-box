# Letter Box

Клиент-серверный почтовый клиент с desktop-приложением для macOS и отдельным
сервером синхронизации Mail.ru и Яндекса.

## Архитектура

```text
Electron + React ──REST / Socket.IO──> NestJS server
                                          ├──> PostgreSQL
                                          ├──> Redis / BullMQ
                                          ├──> sync worker
                                          └──> IMAP (imapflow)
```

Electron не импортирует, не запускает и не упаковывает NestJS. Сервер является
единственным владельцем IMAP-соединений, credentials и почтовых данных. Общие
DTO находятся в `@letter-box/contracts`. Redis координирует блокировки
синхронизации и хранит очередь BullMQ. Отдельный worker владеет длительными
IMAP-задачами, поэтому закрытие desktop или HTTP-соединения их не отменяет.
PostgreSQL — обязательный и
единственный источник серверных данных. SQLite используется только
одноразовым инструментом импорта старой базы и не входит в production runtime.

REST API и Socket.IO защищены JWT. Каждый почтовый аккаунт принадлежит
пользователю Letter Box, а account-oriented endpoints проверяют владельца до
доступа к IMAP credentials или письмам. Короткая access-сессия автоматически
обновляется ротируемым refresh token; logout отзывает текущую refresh-сессию.

При первой синхронизации загружаются метаданные последних 50 писем. Следующие
запуски получают только новые UID, обновляют флаги существующих писем и удаляют
локальные записи, которых больше нет на сервере. В PostgreSQL сохраняются UID,
тема, отправитель, дата, флаги и размер. Тело письма запрашивается с IMAP и
сохраняется только при первом открытии письма.

## Запуск

Требования:

- macOS;
- Node.js 22 или новее;
- пароль приложения Mail.ru или Яндекса.

Установите зависимости:

```bash
npm install
```

Создайте локальную конфигурацию:

```bash
cp .env.example .env
```

Перед внешним запуском задайте разные стойкие значения
`LETTER_BOX_ENCRYPTION_KEY` и `JWT_SECRET`. Первый пользователь может
зарегистрироваться даже при `ALLOW_REGISTRATION=false` и автоматически получает
существующие аккаунты без владельца. Последующая регистрация разрешается только
при `ALLOW_REGISTRATION=true`.

Запустите API, sync worker и desktop-клиент одной dev-командой:

```bash
npm run dev
```

На вкладке «Обзор» можно добавлять, переподключать и явно удалять аккаунты.
Каждый аккаунт открывается в отдельной вкладке; открытые вкладки
восстанавливаются после перезапуска. Закрытие вкладки не удаляет аккаунт.
Кнопка «Обновить все» параллельно синхронизирует разные аккаунты, при этом
повторные запросы синхронизации одного аккаунта объединяются.
Непрочитанные письма выделяются в списке, а их количество отображается в
«Обзоре» и на вкладках аккаунтов. При открытии письмо автоматически отмечается
прочитанным; состояние также можно переключить вручную.
Фоновую синхронизацию можно включать отдельно для каждого аккаунта и запускать
каждые 5, 15 или 30 минут. После восстановления сети приложение обновляет
аккаунты сразу. Опциональные системные уведомления показываются только для
писем, появившихся после уже выполненной первоначальной синхронизации.
Приложение кеширует каталог IMAP-папок и позволяет независимо открывать и
синхронизировать «Входящие», «Отправленные», «Черновики», «Спам», «Корзину»,
«Архив» и пользовательские папки. Выбранная папка запоминается для каждого
аккаунта. Старые письма загружаются страницами по 50 при прокрутке списка.
Письма можно отмечать важными, архивировать, перемещать между папками и
удалять. Обычное удаление перемещает письмо в системную корзину, а удаление
из самой корзины выполняется окончательно.

Сервер также можно запустить независимо:

```bash
npm run infra:up
npm run dev:api -w @letter-box/server
npm run dev:worker -w @letter-box/server
```

Для контейнерного запуска API и worker используйте `npm run server:up`.
Количество параллельных worker-задач задаётся через
`SYNC_WORKER_CONCURRENCY`; одинаковые `accountId + mailbox` дедуплицируются.

Desktop получает адрес через `LETTER_BOX_API_URL`. Серверный bind и CORS
настраиваются через `API_HOST` и `CORS_ORIGINS`.

## macOS-установщик

Соберите неподписанные `.app` и `.dmg`:

```bash
npm run dist:mac
```

Результат появится в `apps/desktop/dist/`. Такой `.dmg` подходит для локальной
установки и тестирования. Для распространения другим пользователям потребуются
Apple Developer ID, code signing и notarization.

Backend больше не входит в Electron-приложение. Серверные credentials
по умолчанию находятся в `./data/credentials.json`. Пароли приложений
шифруются AES-256-GCM;
в production переменная `LETTER_BOX_ENCRYPTION_KEY` обязательна.

## Перенос SQLite в PostgreSQL

Остановите сервер, оставив PostgreSQL запущенным, и выполните:

```bash
DATABASE_URL=postgresql://letter_box:letter_box_dev@127.0.0.1:5432/letter_box \
npm run db:import:sqlite -- ./data/letter-box.db
```

Команда переносит пользователей, аккаунты, UIDVALIDITY, папки и письма одной
транзакцией.
Повторный запуск безопасен: записи обновляются по первичным ключам без
дублирования. Исходный SQLite-файл не изменяется и не удаляется.

Зашифрованный `credentials.json` импортировать не нужно: сохраните его рядом с
сервером и используйте прежние `CREDENTIALS_PATH` и
`LETTER_BOX_ENCRYPTION_KEY`. После проверки PostgreSQL SQLite-файл стоит
сохранить как резервную копию.

Диагностический лог desktop main process:

```text
~/Library/Application Support/Letter Box/logs/main.log
```

Лог автоматически ротируется после 2 МБ, предыдущая версия сохраняется рядом
как `main.log.previous`. Пароль приложения и тела HTTP-запросов в лог не
записываются.

## REST API

Все REST-маршруты имеют префикс `/api/v1`.

| Метод | Путь | Назначение |
| --- | --- | --- |
| `GET` | `/health` | Проверка доступности server |
| `GET` | `/accounts` | Список аккаунтов и их статусы |
| `POST` | `/accounts` | Проверка и добавление аккаунта |
| `PUT` | `/accounts/:accountId` | Переподключение аккаунта |
| `DELETE` | `/accounts/:accountId` | Удаление аккаунта, credentials и локальной почты |
| `POST` | `/accounts/:accountId/imap/connect` | Проверка IMAP-подключения |
| `GET` | `/accounts/:accountId/mailboxes` | Локальный каталог почтовых папок |
| `POST` | `/accounts/:accountId/mailboxes/sync` | Обновление каталога папок с IMAP |
| `POST` | `/accounts/:accountId/mail/sync?mailbox=INBOX` | Синхронизация выбранной папки |
| `GET` | `/accounts/:accountId/mail/sync` | Активные и ожидающие задания синхронизации |
| `GET` | `/accounts/:accountId/messages?mailbox=INBOX` | Локальный список писем |
| `GET` | `/accounts/:accountId/messages/:uid?mailbox=INBOX` | Письмо с ленивой загрузкой тела |
| `PATCH` | `/accounts/:accountId/messages/:uid/seen?mailbox=INBOX` | Изменение состояния прочитано/не прочитано |
| `PATCH` | `/accounts/:accountId/messages/:uid/flagged?mailbox=INBOX` | Изменение флага «важное» |
| `POST` | `/accounts/:accountId/messages/:uid/move?mailbox=INBOX` | Перемещение между папками |
| `POST` | `/accounts/:accountId/messages/:uid/archive?mailbox=INBOX` | Архивирование письма |
| `DELETE` | `/accounts/:accountId/messages/:uid?mailbox=INBOX` | Удаление письма |

По умолчанию API слушает `127.0.0.1:3000`. Для контейнера или внешнего клиента
можно установить `API_HOST=0.0.0.0` и ограничить `CORS_ORIGINS`.

## Проверки

```bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

## Структура

```text
apps/
  backend/   NestJS API и sync worker, PostgreSQL, Redis/BullMQ, imapflow
  desktop/   Electron, React, Vite
packages/
  contracts/ общие DTO и события REST/Socket.IO
```

Подробное описание границ и целевой инфраструктуры:
[`docs/architecture.md`](docs/architecture.md).
