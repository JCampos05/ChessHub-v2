# ChessHub - Backend

API para la gestion de eventos y torneos de ajedrez: inscripciones, rondas, resultados, clasificacion y ratings.

## Requisitos

- Node.js 22 o superior
- pnpm 10
- Docker y Docker Compose

## Arranque rapido

Crear un archivo `.env` en la raiz con, como minimo:

```
DATABASE_URL=postgresql://chesshub:chesshub@localhost:5432/chesshub_dev
JWT_SECRET=un-secreto-de-al-menos-32-caracteres
```

El resto de variables tiene valor por omision (`PORT`, `BCRYPT_COST`, `CORS_ORIGINS`, `LOG_LEVEL`, `SMTP_*`, `APP_BASE_URL`, `STORAGE_DIR`).

Cache de lecturas (opcional):

| Variable | Descripcion | Por omision |
|---|---|---|
| `REDIS_URL` | URL de Redis (`redis://host:6379`). Sin ella se usa solo la memoria del proceso | sin definir |
| `CACHE_TTL_SECONDS` | Vigencia de cada entrada, de 1 a 3600 | 60 |
| `CACHE_LRU_CAPACITY` | Entradas del respaldo en memoria, de 10 a 100000 | 500 |

```bash
pnpm install
docker compose up -d postgres redis mailpit
pnpm exec prisma generate --no-hints
pnpm db:deploy
pnpm db:seed
pnpm dev
```

La API queda en `http://localhost:3000`. Salud: `GET /api/v1/health`.

Para levantar todo en contenedores:

```bash
docker compose up -d --build api
```

## Scripts

| Comando | Descripcion |
|---|---|
| `pnpm dev` | Servidor con recarga |
| `pnpm build` / `pnpm start` | Compila y ejecuta `dist/` |
| `pnpm typecheck` | Verificacion de tipos |
| `pnpm test` | Pruebas unitarias y de integracion |
| `pnpm test:cov` | Pruebas con cobertura (umbral 70 %) |
| `pnpm db:deploy` | Aplica las migraciones |
| `pnpm db:seed` | Catalogo de roles y administrador de desarrollo |
| `pnpm smoke` | Pruebas de humo contra el servidor en marcha |

## Pruebas

Las pruebas de integracion usan una base PostgreSQL real llamada `chesshub_test`. Crearla una vez:

```bash
docker compose exec postgres psql -U chesshub -d chesshub_dev -c "CREATE DATABASE chesshub_test"
```

Las migraciones se aplican solas al iniciar `pnpm test`.

La prueba de rendimiento (`tests/integration/read-performance.test.ts`) carga 50 000 jugadores y 5 000 torneos y tarda alrededor de 35 segundos.

## Estructura

```
src/
  config/        variables de entorno validadas
  lib/           prisma, logger
  shared/        errores, validacion, paginacion
  middlewares/   autenticacion, limite de peticiones, errores
  domain/        logica pura (coincidencia de nombres)
  modules/       auth, users, players, categories, tournaments, rounds, pairings, games, health
  app.ts         createApp()
  server.ts      arranque y cierre ordenado
prisma/          esquema, migraciones y semilla
tests/           unit e integration
scripts/         pruebas de humo
```

## Endpoints de la version actual

| Metodo y ruta | Auth | Descripcion |
|---|---|---|
| `GET /`, `GET /api/v1/health` | no | Estado del servicio y de la base de datos |
| `POST /api/v1/auth/register` | no | Registro de cuenta |
| `POST /api/v1/auth/login` | no | Inicio de sesion |
| `GET /api/v1/auth/me` | Bearer | Perfil con roles y ambitos |
| `POST /api/v1/auth/refresh-token` | no | Renueva el token de acceso |
| `POST /api/v1/auth/logout` | Bearer | Cierra la sesion actual |
| `POST /api/v1/players` | Bearer | Alta de jugador |
| `GET /api/v1/players/:id` | Bearer | Consulta de jugador |

### Recursos con CRUD (entidades y catalogos)

Cada recurso ofrece `GET /` (paginado), `POST /`, `GET /:id`, `PATCH /:id` y `DELETE /:id` (baja logica) bajo `/api/v1`, con Bearer. Leer requiere sesion; escribir requiere un rol con permiso (por ambito cuando aplica).

| Recurso (espanol / ingles) | Notas |
|---|---|
| `/categorias` / `/categories` | Nombre unico sin distinguir mayusculas; rango de edades y costo; filtro `edad` |
| `/torneos` / `/tournaments` | Filtros `q`, `estado` (varios), `ciudad`, `categoryId`, `abiertas`, `desde`, `hasta`; `/:id/categorias` vincula categorias |
| `/jugadores` / `/players` | Filtros `q` (nombre o FIDE), `fideId`, `sex`, `edadMin`, `edadMax`, `ratingMin`, `ratingMax`, `club`, `status` y `federation` (los tres ultimos admiten varios valores); el rating exige permiso propio |
| `/rondas` / `/rounds` | Numero unico por torneo, hasta las rondas planeadas |
| `/emparejamientos` / `/pairings` | Mesa y jugador unicos por ronda; sin negras es descanso (bye) |
| `/partidas` / `/games` | Resultado `PENDING` al crear; PGN y fecha opcionales |

Los listados usan `page`, `limit`, `sortBy`, `order` e `includeInactive`. Los filtros con varios valores los reciben separados por coma (maximo 10, por ejemplo `estado=3,4`); un valor invalido responde 422. Una referencia a un registro inexistente en el cuerpo responde 400 `REFERENCE_NOT_FOUND`.

## Cache

Los listados y el detalle de torneos y categorias, y la vista publica del listado de jugadores, se guardan en Redis con respaldo en memoria. Cada escritura invalida el recurso afectado. La vista con datos de contacto nunca se guarda. Si Redis no esta disponible la API sigue respondiendo, y `GET /api/v1/health` muestra `redis: down` sin devolver 503.

Las busquedas por texto usan indices de trigramas (`pg_trgm`); la migracion `search_indexes` crea la extension, por lo que el usuario de la base necesita permiso para ello.

Los errores tienen la forma `{ status, statusCode, code, message, errors? }`.

## Seguridad

- Contrasenas con bcrypt (costo 12; 4 solo con `NODE_ENV=test`).
- JWT con sesion verificada en base de datos en cada peticion.
- Refresh token con rotacion y deteccion de reutilizacion.
- Bloqueo temporal tras 5 intentos fallidos y limite de peticiones.
- Los datos de contacto de jugadores no salen en respuestas publicas.
