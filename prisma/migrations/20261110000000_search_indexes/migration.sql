-- Índices de búsqueda para los listados (RF10, RF12, RNF02)

-- Trigramas: permiten buscar "contiene" con índice (LIKE '%texto%')
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Búsqueda de jugadores por nombre normalizado
CREATE INDEX "players_normalized_name_trgm_idx" ON "players" USING GIN ("normalized_name" gin_trgm_ops);

-- Filtro por edad (se traduce a un rango de fecha de nacimiento)
CREATE INDEX "players_birth_date_idx" ON "players"("birth_date");

-- Búsqueda de torneos por nombre, sede y ciudad, y filtro exacto por ciudad
CREATE INDEX "tournaments_name_trgm_idx" ON "tournaments" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "tournaments_venue_trgm_idx" ON "tournaments" USING GIN ("venue" gin_trgm_ops);
CREATE INDEX "tournaments_city_trgm_idx" ON "tournaments" USING GIN ("city" gin_trgm_ops);
