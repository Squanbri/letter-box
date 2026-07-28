# Развёртывание Letter Box на своём сервере

Пошаговая инструкция для VPS или домашнего сервера. Desktop-клиент
остаётся на вашем Mac; IMAP/SMTP, PostgreSQL и очередь синхронизации
работают на сервере.

## Что нужно установить

| Компонент | Зачем | Где |
| --- | --- | --- |
| **Docker** + **Docker Compose** | API, worker, PostgreSQL, Redis | сервер |
| **Ollama** (опционально) | AI-теги для непрочитанных писем | сервер (или хост рядом с Docker) |
| **Node.js 22+** | только если собираете desktop локально | ваш Mac |
| Пароли приложений | Mail.ru / Яндекс / Google | у провайдера почты |

Минимальные ресурсы для API + worker + Postgres + Redis: примерно
**1–2 vCPU**, **2 GB RAM**. Если поднимаете Ollama на той же машине —
лучше **4+ GB RAM** (модель `qwen3:0.6b` лёгкая, но LLM всё равно ест память).

## 1. Подготовка сервера

```bash
git clone https://github.com/Squanbri/letter-box.git
cd letter-box
cp .env.example .env
```

Сгенерируйте секреты и пропишите их в `.env`:

```bash
openssl rand -base64 48   # → LETTER_BOX_ENCRYPTION_KEY
openssl rand -base64 48   # → JWT_SECRET
```

Для контейнерного API:

```env
API_HOST=0.0.0.0
ALLOW_REGISTRATION=false
TRUST_PROXY=true
CORS_ORIGINS=http://127.0.0.1:5173
LETTER_BOX_ENCRYPTION_KEY=<ваш ключ>
JWT_SECRET=<ваш секрет>
```

Первый зарегистрированный пользователь создаётся даже при
`ALLOW_REGISTRATION=false`. Дальнейшая публичная регистрация
открывается только если выставить `true`.

## 2. Запуск backend через Docker

```bash
docker compose up -d --build
```

Поднятся:

- `server` — NestJS REST + Socket.IO (`:3000`)
- `worker` — BullMQ sync + AI-классификация
- `postgres` — PostgreSQL 17
- `redis` — очередь BullMQ

Проверка:

```bash
curl -s http://127.0.0.1:3000/api/v1/health
curl -s http://127.0.0.1:3000/api/v1/health/ready
```

`ready` должен подтвердить PostgreSQL, Redis и наличие sync worker.

Остановка:

```bash
docker compose down
```

Данные Postgres/Redis/credentials сохраняются в Docker volumes.

## 3. Ollama (AI-теги)

AI-классификация **опциональна**. Без Ollama почта работает как обычно;
теги просто не появятся. Можно отключить явно:

```env
OLLAMA_ENABLED=false
```

### Установка на хост (рекомендуется)

На Linux-сервере:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama serve          # обычно уже как systemd-сервис
ollama pull qwen3:0.6b
```

На macOS: скачайте приложение с [ollama.com](https://ollama.com), затем:

```bash
ollama pull qwen3:0.6b
```

Worker в `compose.yaml` ходит к Ollama через
`http://host.docker.internal:11434`. Убедитесь, что Ollama слушает
порт `11434` на хосте.

Проверка с сервера:

```bash
curl http://127.0.0.1:11434/api/tags
```

### Переменные

| Переменная | По умолчанию | Смысл |
| --- | --- | --- |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | адрес API Ollama |
| `OLLAMA_MODEL` | `qwen3:0.6b` | модель для тегов |
| `OLLAMA_ENABLED` | `true` | выключить классификацию |
| `CLASSIFY_INTERVAL_MS` | `30000` | пауза между батчами |
| `CLASSIFY_BATCH_SIZE` | `10` | писем за один проход |

После смены модели:

```bash
ollama pull <модель>
# в .env: OLLAMA_MODEL=<модель>
docker compose up -d worker
```

## 4. HTTPS и доступ снаружи

Не открывайте `:3000` в интернет без TLS. Пример с Caddy:

```caddyfile
mail.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Или nginx:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```

При прокси включите `TRUST_PROXY=true`.

## 5. Подключение desktop-клиента

На Mac соберите или запустите клиент, указав URL сервера:

```bash
# dev
LETTER_BOX_API_URL=https://mail.example.com npm run dev -w @letter-box/desktop

# или в .env перед сборкой
LETTER_BOX_API_URL=https://mail.example.com
npm run dist:mac
```

Electron-клиент не требует отдельной CORS-настройки (native Origin
разрешён на сервере). Для Vite-dev оставьте `CORS_ORIGINS` с
`http://127.0.0.1:5173`.

## 6. Пароли приложений у провайдеров

Letter Box использует IMAP + SMTP. Обычный пароль от ящика обычно
не подходит — нужен **пароль приложения**:

- [Mail.ru](https://help.mail.ru/mail/security/protection/external)
- [Яндекс](https://yandex.ru/support/id/ru/authorization/app-passwords)
- [Google](https://myaccount.google.com/apppasswords) (нужен 2FA)

Пароли шифруются на сервере (AES-256-GCM) ключом
`LETTER_BOX_ENCRYPTION_KEY` и хранятся отдельно от PostgreSQL.

## 7. Чеклист безопасности

- [ ] Уникальные `LETTER_BOX_ENCRYPTION_KEY` и `JWT_SECRET`
- [ ] `ALLOW_REGISTRATION=false` после создания своего пользователя
- [ ] HTTPS перед внешним доступом
- [ ] Firewall: наружу только 443 (или SSH + reverse proxy)
- [ ] Регулярный backup Docker volumes Postgres
- [ ] Не коммитьте `.env` и `credentials.json`

## Локальная разработка без Docker-сервера

На машине разработчика часто удобнее поднять только инфраструктуру
в Docker, а API/worker/desktop — через Node:

```bash
cp .env.example .env
npm install
npm run infra:up          # postgres + redis
# опционально: ollama pull qwen3:0.6b
npm run dev               # api + worker + desktop
```

Подробнее — в корневом [README](../README.md).
