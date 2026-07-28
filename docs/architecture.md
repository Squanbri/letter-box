# Letter Box architecture

## Runtime boundary

Letter Box is a client/server application. The desktop package never imports,
starts, or packages the NestJS server.

```text
Desktop / future mobile clients
        │
        ├── JWT REST commands and queries
        └── authenticated Socket.IO server events
                    │
              NestJS server
                    │
        IMAP + server-owned persistence
```

`@letter-box/contracts` is the shared, transport-only package. It must not
depend on Electron, NestJS, IMAP, or a database implementation.

## Desktop application

The React client is organized by visual screens and state ownership:

```text
src/
  app/         providers, theme, shell and global layout
  pages/       auth, overview and mailbox screens with local components
  components/  composed UI shared by screens
  state/       auth, accounts, mail, sync, preferences and workspace state
  shared/      API client, reusable UI, formatting and email HTML utilities
```

TanStack Query owns server state and cache invalidation. Socket.IO events
invalidate the matching account, mailbox, and message queries instead of
maintaining parallel copies of server data. React Context owns session,
workspace tabs, and persisted user preferences. Page-local state is limited to
UI selections such as the active mailbox and message.

Mantine supplies controls, dialogs, loading states, and theme primitives.
Application geometry and the sandboxed email viewer remain custom because they
are specific to the three-column desktop layout.

## Authentication and ownership

Letter Box users authenticate with email and a scrypt-hashed password. The
server issues a 15-minute access JWT and a 30-day opaque refresh token. Only a
SHA-256 hash of the refresh token is stored. Refresh rotates the token
transactionally, so replaying the previous value fails; logout revokes the
current refresh session. The global HTTP guard protects every endpoint except
health, registration, login, and refresh. Account mail routes additionally
verify that `accounts.user_id` matches the authenticated JWT subject.

Socket.IO verifies the same JWT during the handshake. Server events are emitted
only to connected users that own the event account. The first registered user
claims legacy accounts with no owner; later public registration is controlled
by `ALLOW_REGISTRATION`.

## Server persistence

PostgreSQL is the required and only server source of truth. Credentials are
encrypted by the server using AES-256-GCM and a key provided through
`LETTER_BOX_ENCRYPTION_KEY`.

The PostgreSQL data model is declared in Prisma Schema. Prisma 7 uses the
official `pg` driver adapter and a single NestJS-managed Prisma Client per
process. Account, auth, mailbox, and message persistence use typed Prisma
queries and interactive transactions. Direct `pg` access is limited to
bootstrapping the already-deployed SQL migration history.

Application services and controllers access PostgreSQL through asynchronous
repository contracts. Account and mail repositories own SQL, transactions,
and persistence-specific row mapping.

Redis stores the durable BullMQ sync queue. Identical active
`accountId + mailbox` jobs share one queue job. Failed jobs use bounded
exponential retries. Before each job the worker reloads encrypted credentials
from the shared server credential volume, so it does not depend on API process
memory. An in-process promise map still deduplicates identical calls inside one
worker instance.

## Local AI classification

The sync worker optionally classifies unread messages with a local Ollama
model (`OLLAMA_MODEL`, default `qwen3:0.6b`). Classification is best-effort:
mail sync continues if Ollama is down or `OLLAMA_ENABLED=false`. Tags are
stored on message rows and exposed through REST for filtering and the unified
inbox. See [self-hosting.md](self-hosting.md) for install and model pull steps.

## Target infrastructure

`compose.yaml` provisions the API server, sync worker, PostgreSQL and Redis.
PostgreSQL is the source of truth. Redis backs the durable BullMQ queue.
Ollama usually runs on the host; the worker reaches it via
`host.docker.internal` when containers are used.

REST remains the command/query transport. Socket.IO events notify all connected
clients about synchronization progress and later about message mutations.
The liveness endpoint covers the API process itself; readiness additionally
checks PostgreSQL, Redis, and at least one registered BullMQ worker. Socket
connections are closed when their access JWT expires. After reconnecting with
a refreshed token, clients reconcile account and queue state through REST.
