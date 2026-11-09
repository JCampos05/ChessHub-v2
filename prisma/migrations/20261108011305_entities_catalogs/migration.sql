-- CreateEnum
CREATE TYPE "tournament_status" AS ENUM ('REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'ROUND_IN_PROGRESS', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "round_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'FINISHED');

-- CreateEnum
CREATE TYPE "game_result" AS ENUM ('PENDING', 'WHITE_WINS', 'BLACK_WINS', 'DRAW');

-- AlterTable
ALTER TABLE "players" ADD COLUMN     "rating_elo" DECIMAL(6,1);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "min_age" INTEGER,
    "max_age" INTEGER,
    "default_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "uses_elo" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournaments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "venue" TEXT,
    "city" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "rounds_planned" INTEGER,
    "max_players" INTEGER,
    "time_control" TEXT,
    "status" "tournament_status" NOT NULL DEFAULT 'REGISTRATION_OPEN',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_categories" (
    "tournament_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_categories_pkey" PRIMARY KEY ("tournament_id","category_id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" UUID NOT NULL,
    "tournament_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "round_status" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pairings" (
    "id" UUID NOT NULL,
    "tournament_id" UUID NOT NULL,
    "round_number" INTEGER NOT NULL,
    "board" INTEGER NOT NULL,
    "white_player_id" UUID NOT NULL,
    "black_player_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pairings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" UUID NOT NULL,
    "tournament_id" UUID NOT NULL,
    "round_number" INTEGER NOT NULL,
    "pairing_id" UUID,
    "white_player_id" UUID NOT NULL,
    "black_player_id" UUID NOT NULL,
    "result" "game_result" NOT NULL DEFAULT 'PENDING',
    "pgn" TEXT,
    "played_at" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tournaments_start_date_idx" ON "tournaments"("start_date");

-- CreateIndex
CREATE INDEX "tournaments_status_start_date_idx" ON "tournaments"("status", "start_date");

-- CreateIndex
CREATE INDEX "tournament_categories_category_id_idx" ON "tournament_categories"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "rounds_tournament_id_number_key" ON "rounds"("tournament_id", "number");

-- CreateIndex
CREATE INDEX "pairings_white_player_id_idx" ON "pairings"("white_player_id");

-- CreateIndex
CREATE INDEX "pairings_black_player_id_idx" ON "pairings"("black_player_id");

-- CreateIndex
CREATE UNIQUE INDEX "pairings_tournament_id_round_number_board_key" ON "pairings"("tournament_id", "round_number", "board");

-- CreateIndex
CREATE UNIQUE INDEX "pairings_tournament_id_round_number_white_player_id_key" ON "pairings"("tournament_id", "round_number", "white_player_id");

-- CreateIndex
CREATE UNIQUE INDEX "pairings_tournament_id_round_number_black_player_id_key" ON "pairings"("tournament_id", "round_number", "black_player_id");

-- CreateIndex
CREATE UNIQUE INDEX "games_pairing_id_key" ON "games"("pairing_id");

-- CreateIndex
CREATE INDEX "games_tournament_id_round_number_idx" ON "games"("tournament_id", "round_number");

-- CreateIndex
CREATE INDEX "games_white_player_id_idx" ON "games"("white_player_id");

-- CreateIndex
CREATE INDEX "games_black_player_id_idx" ON "games"("black_player_id");

-- CreateIndex
CREATE INDEX "players_rating_elo_fide_id_idx" ON "players"("rating_elo", "fide_id");

-- CreateIndex
CREATE INDEX "players_club_code_idx" ON "players"("club_code");

-- AddForeignKey
ALTER TABLE "tournament_categories" ADD CONSTRAINT "tournament_categories_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_categories" ADD CONSTRAINT "tournament_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairings" ADD CONSTRAINT "pairings_tournament_id_round_number_fkey" FOREIGN KEY ("tournament_id", "round_number") REFERENCES "rounds"("tournament_id", "number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairings" ADD CONSTRAINT "pairings_white_player_id_fkey" FOREIGN KEY ("white_player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairings" ADD CONSTRAINT "pairings_black_player_id_fkey" FOREIGN KEY ("black_player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_tournament_id_round_number_fkey" FOREIGN KEY ("tournament_id", "round_number") REFERENCES "rounds"("tournament_id", "number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_pairing_id_fkey" FOREIGN KEY ("pairing_id") REFERENCES "pairings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_white_player_id_fkey" FOREIGN KEY ("white_player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_black_player_id_fkey" FOREIGN KEY ("black_player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restricciones que Prisma no expresa
-- 1. El nombre de la categoria es unico sin distinguir mayusculas
CREATE UNIQUE INDEX "categories_name_lower_key" ON "categories" (lower("name"));

-- 2. Rangos y coherencia de datos
ALTER TABLE "categories" ADD CONSTRAINT "categories_age_range_check"
    CHECK (("min_age" IS NULL OR "min_age" >= 0) AND ("max_age" IS NULL OR "max_age" >= 0)
           AND ("min_age" IS NULL OR "max_age" IS NULL OR "min_age" <= "max_age"));
ALTER TABLE "categories" ADD CONSTRAINT "categories_default_cost_check" CHECK ("default_cost" >= 0);

ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_date_range_check" CHECK ("end_date" >= "start_date");
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_rounds_planned_check" CHECK ("rounds_planned" IS NULL OR "rounds_planned" >= 1);
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_max_players_check" CHECK ("max_players" IS NULL OR "max_players" >= 2);

ALTER TABLE "players" ADD CONSTRAINT "players_rating_elo_check" CHECK ("rating_elo" IS NULL OR ("rating_elo" >= 0 AND "rating_elo" <= 3000));

ALTER TABLE "rounds" ADD CONSTRAINT "rounds_number_check" CHECK ("number" >= 1);

ALTER TABLE "pairings" ADD CONSTRAINT "pairings_board_check" CHECK ("board" >= 1);
ALTER TABLE "pairings" ADD CONSTRAINT "pairings_players_differ_check"
    CHECK ("black_player_id" IS NULL OR "white_player_id" <> "black_player_id");

ALTER TABLE "games" ADD CONSTRAINT "games_players_differ_check" CHECK ("white_player_id" <> "black_player_id");
