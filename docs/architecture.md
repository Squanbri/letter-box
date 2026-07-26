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
process. Account persistence is implemented with typed Prisma queries. The
mail and auth repositories remain compatible with the existing SQL boundary
while they are migrated incrementally.

Application services and controllers access PostgreSQL through asynchronous
repository contracts. Account and mail repositories own SQL, transactions,
and persistence-specific row mapping.

Redis provides the distributed synchronization lock when `REDIS_URL` is set.
The in-process promise cache still deduplicates identical calls inside one
server instance, while Redis prevents another instance from starting the same
account/mailbox job. Leases are renewed while a long synchronization is active.

Mailbox synchronization is submitted to a durable BullMQ queue and executed by
a separate worker process. The API may wait for a result for transport
compatibility, but disconnecting the HTTP client does not cancel the job.
Identical active `accountId + mailbox` jobs share one queue job. Failed jobs use
bounded exponential retries. Before each job the worker reloads encrypted
credentials from the shared server credential volume, so it does not depend on
API process memory.

Existing installations use the explicit `db:import:sqlite` command. It reads
SQLite in read-only mode and upserts all account, mailbox state, mailbox, and
message rows in one PostgreSQL transaction. Target tables are locked during
the import, the source file is never modified, and rerunning the command does
not duplicate composite message keys. `better-sqlite3` is therefore a
development/migration dependency and is absent from the production server
runtime.

## Target infrastructure

`compose.yaml` provisions the API server, sync worker, PostgreSQL and Redis.
PostgreSQL is the source of truth. Redis backs synchronization locks and the
durable BullMQ queue, and can later host separate AI job queues.

REST remains the command/query transport. Socket.IO events notify all connected
clients about synchronization progress and later about message mutations.
The liveness endpoint covers the API process itself; readiness additionally
checks PostgreSQL, Redis, and at least one registered BullMQ worker. Socket
connections are closed when their access JWT expires. After reconnecting with
a refreshed token, clients reconcile account and queue state through REST.
