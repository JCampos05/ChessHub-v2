-- Historial de cambios de estado y bandeja de notificaciones

-- CreateEnum
CREATE TYPE "state_entity_type" AS ENUM ('TOURNAMENT');

-- CreateTable
CREATE TABLE "state_changes" (
    "id" UUID NOT NULL,
    "entity_type" "state_entity_type" NOT NULL,
    "entity_id" UUID NOT NULL,
    "from_state" TEXT NOT NULL,
    "to_state" TEXT NOT NULL,
    "changed_by_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "state_changes_pkey" PRIMARY KEY ("id"),
    -- Un cambio siempre cambia de estado
    CONSTRAINT "state_changes_distinct_chk" CHECK ("from_state" <> "to_state"),
    CONSTRAINT "state_changes_reason_chk" CHECK ("reason" IS NULL OR char_length("reason") <= 500)
);

-- Consulta del historial de una entidad, del más reciente al más antiguo
CREATE INDEX "state_changes_entity_type_entity_id_created_at_idx" ON "state_changes"("entity_type", "entity_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "state_changes" ADD CONSTRAINT "state_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "dedupe_key" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "emailed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_title_chk" CHECK (char_length("title") > 0)
);

-- Un mismo cambio no genera dos notificaciones para el mismo usuario (idempotencia del trabajador)
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- Bandeja del usuario, de la más reciente a la más antigua
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- Conteo de no leídas: el índice parcial solo contiene las pendientes
CREATE INDEX "notifications_unread_idx" ON "notifications"("user_id") WHERE "read_at" IS NULL;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
