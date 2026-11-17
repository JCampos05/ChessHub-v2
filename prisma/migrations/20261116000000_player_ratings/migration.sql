-- Ratings por sistema y ritmo con historial, y preferencia de rating del torneo

-- CreateEnum
CREATE TYPE "rating_system" AS ENUM ('FIDE', 'NATIONAL', 'STATE');

-- CreateEnum
CREATE TYPE "rating_pace" AS ENUM ('STANDARD', 'RAPID', 'BLITZ');

-- Preferencia del torneo para sembrar y emparejar
ALTER TABLE "tournaments"
  ADD COLUMN "rating_system" "rating_system" NOT NULL DEFAULT 'FIDE',
  ADD COLUMN "rating_pace" "rating_pace" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "rating_state_code" TEXT,
  ADD CONSTRAINT "tournaments_rating_state_code_chk" CHECK ("rating_state_code" IS NULL OR "rating_state_code" ~ '^[A-Z]{2,5}$');

-- CreateTable
CREATE TABLE "player_ratings" (
    "id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "system" "rating_system" NOT NULL,
    "pace" "rating_pace" NOT NULL,
    "state_code" TEXT,
    "value" DECIMAL(6,1) NOT NULL,
    "valid_from" DATE NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_ratings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "player_ratings_value_chk" CHECK ("value" >= 0 AND "value" <= 3500),
    -- Solo el rating estatal lleva estado, y siempre lo lleva
    CONSTRAINT "player_ratings_state_chk" CHECK (("system" = 'STATE') = ("state_code" IS NOT NULL)),
    CONSTRAINT "player_ratings_state_format_chk" CHECK ("state_code" IS NULL OR "state_code" ~ '^[A-Z]{2,5}$')
);

-- Una versión por jugador, sistema, ritmo, estado y fecha de vigencia (el estado nulo cuenta como vacío)
CREATE UNIQUE INDEX "player_ratings_version_uq" ON "player_ratings"("player_id", "system", "pace", COALESCE("state_code", ''), "valid_from");

CREATE INDEX "player_ratings_player_id_system_pace_valid_from_idx" ON "player_ratings"("player_id", "system", "pace", "valid_from");

-- AddForeignKey
ALTER TABLE "player_ratings" ADD CONSTRAINT "player_ratings_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
