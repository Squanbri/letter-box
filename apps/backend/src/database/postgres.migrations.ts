export interface PostgresMigration {
  version: number;
  name: string;
  sql: string;
}

export const postgresMigrations: PostgresMigration[] = [
  {
    version: 1,
    name: 'initial multi-account schema',
    sql: `
      CREATE TABLE accounts (
        id UUID PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('mailru', 'yandex')),
        email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'disconnected'
          CHECK (status IN ('disconnected', 'connected', 'syncing', 'error')),
        last_error TEXT,
        last_sync_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE mailbox_state (
        account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        mailbox TEXT NOT NULL,
        uid_validity TEXT NOT NULL,
        PRIMARY KEY (account_id, mailbox)
      );

      CREATE TABLE mailboxes (
        account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        delimiter TEXT NOT NULL,
        special_use TEXT,
        total_count INTEGER NOT NULL DEFAULT 0,
        unread_count INTEGER NOT NULL DEFAULT 0,
        listed_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (account_id, path)
      );

      CREATE TABLE messages (
        account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        mailbox TEXT NOT NULL,
        uid BIGINT NOT NULL,
        subject TEXT,
        sender_name TEXT,
        sender_address TEXT,
        received_at TIMESTAMPTZ NOT NULL,
        flags JSONB NOT NULL DEFAULT '[]'::jsonb,
        size BIGINT NOT NULL,
        body_text TEXT,
        body_html TEXT,
        body_loaded_at TIMESTAMPTZ,
        PRIMARY KEY (account_id, mailbox, uid),
        CHECK (jsonb_typeof(flags) = 'array')
      );

      CREATE INDEX idx_messages_received_at
      ON messages(account_id, mailbox, received_at DESC, uid DESC);

      CREATE INDEX idx_messages_unread_inbox
      ON messages(account_id)
      WHERE mailbox = 'INBOX' AND NOT (flags ? '\\Seen');
    `,
  },
  {
    version: 2,
    name: 'application users and account ownership',
    sql: `
      CREATE TABLE users (
        id UUID PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        CHECK (email = LOWER(email))
      );

      ALTER TABLE accounts
      ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;

      CREATE INDEX idx_accounts_user_created
      ON accounts(user_id, created_at);
    `,
  },
  {
    version: 3,
    name: 'rotating refresh sessions',
    sql: `
      CREATE TABLE auth_sessions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX idx_auth_sessions_user
      ON auth_sessions(user_id);

      CREATE INDEX idx_auth_sessions_expiry
      ON auth_sessions(expires_at);
    `,
  },
  {
    version: 4,
    name: 'add gmail provider',
    sql: `
      ALTER TABLE accounts
      DROP CONSTRAINT accounts_provider_check;

      ALTER TABLE accounts
      ADD CONSTRAINT accounts_provider_check
      CHECK (provider IN ('mailru', 'yandex', 'gmail'));
    `,
  },
  {
    version: 5,
    name: 'prepare messages for local classification',
    sql: `
      ALTER TABLE messages
      ADD COLUMN classification_text TEXT,
      ADD COLUMN classification_status TEXT NOT NULL DEFAULT 'pending',
      ADD COLUMN classified_at TIMESTAMPTZ;

      ALTER TABLE messages
      ADD CONSTRAINT messages_classification_status_check
      CHECK (classification_status IN ('pending', 'processing', 'completed', 'failed'));

      CREATE INDEX idx_messages_classification_status
      ON messages(account_id, mailbox, classification_status);
    `,
  },
  {
    version: 6,
    name: 'message classification tags',
    sql: `
      ALTER TABLE messages
      ADD COLUMN tags JSONB NOT NULL DEFAULT '[]'::jsonb;

      ALTER TABLE messages
      ADD CONSTRAINT messages_tags_array_check
      CHECK (jsonb_typeof(tags) = 'array');
    `,
  },
  {
    version: 7,
    name: 'message conversation threading',
    sql: `
      ALTER TABLE messages
      ADD COLUMN message_id TEXT,
      ADD COLUMN in_reply_to TEXT,
      ADD COLUMN references_header TEXT,
      ADD COLUMN thread_id TEXT;

      CREATE INDEX idx_messages_message_id
      ON messages(account_id, message_id)
      WHERE message_id IS NOT NULL;

      CREATE INDEX idx_messages_thread_id
      ON messages(account_id, thread_id, received_at ASC, uid ASC)
      WHERE thread_id IS NOT NULL;
    `,
  },
];
