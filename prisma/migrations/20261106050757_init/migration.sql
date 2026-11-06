-- CreateEnum
CREATE TYPE "scope_type" AS ENUM ('FEDERATION', 'STATE', 'MUNICIPALITY', 'TOURNAMENT');

-- CreateEnum
CREATE TYPE "player_status" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "access_event" AS ENUM ('REGISTER', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'ACCOUNT_LOCKED', 'REFRESH', 'REFRESH_REUSE', 'LOGOUT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_type" "scope_type" NOT NULL,
    "scope_id" UUID,
    "note" TEXT,
    "assigned_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "device" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_logs" (
    "id" UUID NOT NULL,
    "event" "access_event" NOT NULL,
    "user_id" UUID,
    "email_attempted" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "birth_date" DATE,
    "sex" TEXT,
    "federation" TEXT NOT NULL DEFAULT 'MEX',
    "fide_id" TEXT,
    "national_id" TEXT,
    "club_code" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "status" "player_status" NOT NULL DEFAULT 'PENDING',
    "k_factor" INTEGER,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE INDEX "user_roles_user_id_idx" ON "user_roles"("user_id");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "access_logs_user_id_created_at_idx" ON "access_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "access_logs_created_at_idx" ON "access_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "players_fide_id_key" ON "players"("fide_id");

-- CreateIndex
CREATE UNIQUE INDEX "players_national_id_key" ON "players"("national_id");

-- CreateIndex
CREATE INDEX "players_name_key_idx" ON "players"("name_key");

-- CreateIndex
CREATE INDEX "players_normalized_name_idx" ON "players"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "players_name_key_birth_date_key" ON "players"("name_key", "birth_date");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Restricciones que Prisma no expresa
-- 1. El correo es unico sin distinguir mayusculas, garantizado por la base de datos
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" (lower("email"));

-- 2. Una asignacion de rol no se repite para el mismo usuario, rol y ambito
CREATE UNIQUE INDEX "user_roles_unique_assignment"
    ON "user_roles" ("user_id", "role_id", "scope_type", COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'::uuid));

-- 3. Solo el ambito FEDERATION puede (y debe) tener scope_id vacio
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_scope_consistency_check"
    CHECK (("scope_type" = 'FEDERATION') = ("scope_id" IS NULL));

-- Catalogo de roles
INSERT INTO "roles" ("id", "code", "name", "description") VALUES
    (gen_random_uuid(), 'SUPER_ADMIN', 'Administrador', 'Acceso total al sistema'),
    (gen_random_uuid(), 'FEDERATION_ADMIN', 'Administrador de federacion', 'Administracion nacional'),
    (gen_random_uuid(), 'STATE_ADMIN', 'Administrador estatal', 'Torneos y comites de su estado'),
    (gen_random_uuid(), 'MUNICIPAL_ADMIN', 'Administrador municipal', 'Torneos de su municipio'),
    (gen_random_uuid(), 'ORGANIZER', 'Organizador de torneo', 'Opera un torneo asignado'),
    (gen_random_uuid(), 'CHIEF_ARBITER', 'Arbitro principal', 'Genera rondas y valida resultados'),
    (gen_random_uuid(), 'ARBITER', 'Arbitro de mesa', 'Captura resultados de sus mesas'),
    (gen_random_uuid(), 'TREASURER', 'Tesorero', 'Pagos y finanzas del torneo'),
    (gen_random_uuid(), 'RATING_OFFICER', 'Responsable de ratings', 'Importa y actualiza ratings'),
    (gen_random_uuid(), 'PLAYER', 'Jugador', 'Consulta y edita su propio perfil')
ON CONFLICT ("code") DO NOTHING;
