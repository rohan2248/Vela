-- Required before email_index, which declares a vector(384) column.
-- pg_trgm backs the fuzzy sender/recipient lookups in the cached search path.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "corsair_permissions" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "token" TEXT NOT NULL,
    "plugin" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "args" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "corsair_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connected_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider_email" TEXT,
    "gmail_history_id" TEXT,
    "gmail_watch_expires_at" TIMESTAMPTZ,
    "calendar_channel_id" TEXT,
    "calendar_resource_id" TEXT,
    "calendar_watch_expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "connected_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_threads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "parts" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_state" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "cursor" TEXT,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER,
    "error" TEXT,
    "started_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_index" (
    "entity_row_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "thread_id" TEXT,
    "subject" TEXT,
    "from_addr" TEXT,
    "to_addr" TEXT,
    "snippet" TEXT,
    "body_text" TEXT,
    "sent_at" TIMESTAMPTZ,
    "label_ids" TEXT[],
    "content_hash" TEXT NOT NULL,
    "embedding" vector(384),
    "fts" tsvector,
    "indexed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_index_pkey" PRIMARY KEY ("entity_row_id")
);

-- CreateIndex
CREATE INDEX "corsair_permissions_tenant_id_idx" ON "corsair_permissions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "corsair_permissions_token_key" ON "corsair_permissions"("token");

-- CreateIndex
CREATE INDEX "connected_accounts_provider_email_provider_idx" ON "connected_accounts"("provider_email", "provider");

-- CreateIndex
CREATE INDEX "connected_accounts_tenant_id_idx" ON "connected_accounts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "connected_accounts_user_id_provider_key" ON "connected_accounts"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "connected_accounts_calendar_channel_id_key" ON "connected_accounts"("calendar_channel_id");

-- CreateIndex
CREATE INDEX "chat_threads_user_id_updated_at_idx" ON "chat_threads"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "chat_messages_thread_id_created_at_idx" ON "chat_messages"("thread_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sync_state_tenant_id_kind_key" ON "sync_state"("tenant_id", "kind");

-- CreateIndex
CREATE INDEX "email_index_tenant_id_sent_at_idx" ON "email_index"("tenant_id", "sent_at");

-- AddForeignKey
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Beyond what Prisma can express
-- ---------------------------------------------------------------------------

-- Tie the index to the Corsair cache row it describes, so entities Corsair
-- deletes (e.g. gmail.webhook.messageDeleted) take their index entry with them.
ALTER TABLE "email_index"
  ADD CONSTRAINT "email_index_entity_row_id_fkey"
  FOREIGN KEY ("entity_row_id") REFERENCES "corsair_entities"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma emits `fts` as a plain column; it needs to be generated so it can
-- never drift out of sync with subject/body_text.
ALTER TABLE "email_index" DROP COLUMN "fts";
ALTER TABLE "email_index" ADD COLUMN "fts" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("subject", '') || ' ' || coalesce("body_text", ''))
  ) STORED;

-- Vector recall. HNSW over cosine distance — matches the `<=>` operator used
-- by lib/search/semantic.ts. Built on an empty table, so it is cheap here.
CREATE INDEX "email_index_embedding_hnsw"
  ON "email_index" USING hnsw ("embedding" vector_cosine_ops);

-- Lexical recall, fused with the vector side via RRF.
CREATE INDEX "email_index_fts_gin" ON "email_index" USING gin ("fts");

-- Fuzzy sender/recipient matching ("mail from stripe" -> billing@stripe.com).
CREATE INDEX "email_index_from_trgm" ON "email_index" USING gin ("from_addr" gin_trgm_ops);
CREATE INDEX "email_index_to_trgm"   ON "email_index" USING gin ("to_addr" gin_trgm_ops);

-- Corsair ships no indexes on its own cache table. Without these, the cached
-- search path degrades to a sequential scan over rows that can each hold a
-- multi-megabyte base64 `raw` payload.
CREATE INDEX IF NOT EXISTS "corsair_entities_account_type_idx"
  ON "corsair_entities" ("account_id", "entity_type");

-- Recency ordering. internalDate is epoch milliseconds as text, so it is cast
-- to a number; data.createdAt is a sync timestamp and must not be used here.
CREATE INDEX IF NOT EXISTS "corsair_entities_internal_date_idx"
  ON "corsair_entities" ("account_id", (("data" ->> 'internalDate')::bigint) DESC)
  WHERE "entity_type" = 'messages';

-- Fast tenant lookup during webhook fan-in.
CREATE INDEX IF NOT EXISTS "corsair_accounts_tenant_integration_idx"
  ON "corsair_accounts" ("tenant_id", "integration_id");
