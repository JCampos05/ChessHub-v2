-- Inscripciones con cupo atómico y rondas generadas (RF15..RF18, RNF03)

-- CreateEnum
CREATE TYPE "registration_status" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "pairing_origin" AS ENUM ('MANUAL', 'AUTO');

-- Cupo y folio por torneo: la reserva se hace con un UPDATE condicional sobre estas columnas
ALTER TABLE "tournaments"
  ADD COLUMN "registered_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "registration_counter" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "tournaments_registered_count_nonneg_chk" CHECK ("registered_count" >= 0),
  ADD CONSTRAINT "tournaments_registered_count_cap_chk" CHECK ("max_players" IS NULL OR "registered_count" <= "max_players");

-- Origen de cada mesa: las existentes son manuales
ALTER TABLE "pairings" ADD COLUMN "origin" "pairing_origin" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "registrations" (
    "id" UUID NOT NULL,
    "tournament_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "folio" INTEGER NOT NULL,
    "status" "registration_status" NOT NULL DEFAULT 'ACTIVE',
    "payment_status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "payment_confirmed_by_id" UUID,
    "payment_confirmed_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "registrations_folio_positive_chk" CHECK ("folio" > 0)
);

-- Un folio por torneo, nunca repetido (tampoco tras cancelar)
CREATE UNIQUE INDEX "registrations_tournament_id_folio_key" ON "registrations"("tournament_id", "folio");

-- Una sola inscripción activa por jugador y torneo; una cancelada permite reinscribirse
CREATE UNIQUE INDEX "registrations_active_player_uq" ON "registrations"("tournament_id", "player_id") WHERE "status" = 'ACTIVE';

CREATE INDEX "registrations_tournament_id_status_idx" ON "registrations"("tournament_id", "status");
CREATE INDEX "registrations_player_id_idx" ON "registrations"("player_id");
CREATE INDEX "registrations_category_id_idx" ON "registrations"("category_id");

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "registrations" ADD CONSTRAINT "registrations_tournament_id_category_id_fkey" FOREIGN KEY ("tournament_id", "category_id") REFERENCES "tournament_categories"("tournament_id", "category_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "registrations" ADD CONSTRAINT "registrations_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
