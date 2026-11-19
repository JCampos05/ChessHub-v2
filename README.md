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

Notificaciones de cambios de estado (opcional):

| Variable | Descripcion | Por omision |
|---|---|---|
| `WORKER_ENABLED` | El servidor consume la cola de notificaciones; ponerla en `false` en replicas dedicadas a HTTP | `true` |
| `NOTIFICATION_ATTEMPTS` | Intentos por trabajo, de 1 a 20 | 5 |
| `NOTIFICATION_BACKOFF_MS` | Base de la espera exponencial entre intentos | 1000 |
| `MAIL_ENABLED` | Envia correo ademas de la bandeja (`SMTP_*`; Mailpit en local) | `false` |

Con `REDIS_URL` la cola vive en Redis (BullMQ); sin ella, en memoria del proceso.

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
| `pnpm worker` / `pnpm worker:start` | Consumidor de notificaciones sin servidor HTTP (con `tsx` o desde `dist/`) |
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

### Integracion continua

El flujo `.github/workflows/ci.yml` se ejecuta en cada push, etiqueta `v*` y pull request: levanta PostgreSQL 16 y Redis 7 (con `TEST_REDIS_URL` corre la prueba de la cola BullMQ real; sin esa variable se omite), instala con `pnpm install --frozen-lockfile`, genera el cliente de Prisma y corre `pnpm typecheck`, `pnpm test:cov` (umbral global de 70 %) y `pnpm build`; ademas construye la imagen de Docker. Para reproducirlo en local basta con `pnpm typecheck && pnpm test:cov && pnpm build`.

## Estructura

```
src/
  config/        variables de entorno validadas
  lib/           prisma, logger, cache, redis, correo y cola de notificaciones
  shared/        errores, validacion, paginacion
  middlewares/   autenticacion, limite de peticiones, errores
  domain/        logica pura (coincidencia de nombres, edad, cache, permisos, emparejamiento suizo, desempates)
  modules/       auth, users, players, categories, tournaments, registrations, rounds, pairings, games, notifications, health
  app.ts         createApp()
  server.ts      arranque y cierre ordenado
  worker.ts      consumidor de notificaciones independiente
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

### Inscripciones y generacion de rondas

| Metodo y ruta | Permiso | Descripcion |
|---|---|---|
| `POST /api/v1/torneos/:id/inscripciones` | `registration:manage` | Inscribe a `{ playerId, categoryId }`; responde 201 con el folio |
| `GET /api/v1/torneos/:id/inscripciones` | `registration:manage` | Lista paginada (por omision solo activas); filtros `status`, `paymentStatus`, `categoryId` |
| `DELETE /api/v1/torneos/:id/inscripciones/:registrationId` | `registration:manage` | Cancela, libera el cupo y conserva el folio |
| `PATCH /api/v1/torneos/:id/inscripciones/:registrationId/pago` | `payment:confirm` | Confirma el pago |
| `POST /api/v1/torneos/:id/rondas/generar` | `round:manage` | Cierra la ronda anterior y genera la siguiente |

Alias en ingles: `/tournaments/:id/registrations` y `/tournaments/:id/rounds/generate`. Los permisos se evaluan por rol y ambito del torneo.

- **Cupo y folio:** se reservan con una sola sentencia condicional en la base; no se vende un cupo de mas ni se repite un folio aunque lleguen muchas peticiones a la vez. Errores de conflicto: `CAPACITY_FULL`, `ALREADY_REGISTERED`, `REGISTRATION_CLOSED`, `AGE_NOT_ELIGIBLE`.
- **Generar ronda:** requiere al menos 2 inscripciones activas y que las partidas de la ronda anterior tengan resultado; la ronda anterior pasa a `FINISHED` y la nueva queda `IN_PROGRESS`, todo en una transaccion. Errores de conflicto: `NOT_ENOUGH_PLAYERS`, `PREVIOUS_ROUND_UNFINISHED`, `ROUNDS_COMPLETE`, `ROUND_DUPLICATE`, `NO_VALID_PAIRING`.
- **Emparejamiento:** sistema suizo; ordena por puntaje, Buchholz, rating y folio; el jugador que queda solo en su grupo de puntaje baja al grupo mas cercano; nadie repite rival ni descansa dos veces; el balance de color se mantiene entre -2 y +2.
- Los listados de inscripciones nunca incluyen telefono ni correo.

### Estados del torneo y notificaciones

Ciclo: `REGISTRATION_OPEN` (convocatoria) → `REGISTRATION_CLOSED` (inscripciones cerradas) → `IN_PROGRESS` (en juego) ⇄ `ROUND_IN_PROGRESS` (ronda en curso) → `FINISHED` (finalizado); `CANCELLED` (cancelado) es posible desde cualquier estado no final. Finalizado y cancelado no tienen salida.

| Metodo y ruta | Permiso | Descripcion |
|---|---|---|
| `PATCH /api/v1/torneos/:id/estado` | `tournament:update` | Cambia el estado con `{ estado, motivo? }`; el estado puede ir como codigo, nombre en espanol o numero (1 a 6) |
| `PATCH /api/v1/torneos/:id/convocatoria`, `/inscripciones_cerradas`, `/en_juego`, `/ronda_en_curso`, `/finalizado`, `/cancelado` | `tournament:update` | Lo mismo con el destino fijado por la ruta; solo `/cancelado` usa `motivo` |
| `GET /api/v1/torneos/:id/historial-estados` | autenticado | Cambios de estado, del mas reciente al mas antiguo |
| `GET /api/v1/notificaciones` | autenticado | Bandeja propia, paginada; filtro `leida=true\|false` |
| `GET /api/v1/notificaciones/unread-count` | autenticado | `{ count }` de las no leidas |
| `PATCH /api/v1/notificaciones/:id/leida` | autenticado | Marca una como leida (idempotente); una ajena responde 404 |
| `PATCH /api/v1/notificaciones/leer-todas` | autenticado | Marca todas las propias; responde `{ updated }` |

Alias en ingles: `/tournaments/:id/status`, `/status-history`, `/notifications`, `/:id/read` y `/read-all`.

- **Transiciones:** se validan en el dominio y se aplican en una transaccion con el torneo bloqueado, junto con el historial y el encolado del aviso. Errores: 422 `INVALID_STATE_TRANSITION` (la transicion no existe) y 422 `STATE_PRECONDITION_FAILED` (faltan condiciones: al menos 2 inscritos para iniciar, ronda con mesas para ponerla en curso, partidas con resultado para cerrarla, rondas terminadas para finalizar). Un estado desconocido responde 400.
- **Rondas:** `ronda_en_curso` inicia la ronda abierta y volver a `en_juego` la cierra. Generar una ronda exige el torneo en `IN_PROGRESS` (409 `TOURNAMENT_NOT_IN_PROGRESS` en caso contrario).
- **Avisos:** el cambio genera un trabajo en la cola; un consumidor crea una notificacion para el creador del torneo y para quien tenga un rol con ambito de ese torneo. El proceso es idempotente: un reintento no duplica filas ni correos. Si la cola no acepta el trabajo, la transaccion se revierte y la API responde 503 `QUEUE_UNAVAILABLE`.
- **Consumidor:** va integrado en el servidor (`WORKER_ENABLED=true`) o corre aparte con `pnpm worker`.

### Ratings por sistema y ritmo

| Metodo y ruta | Permiso | Descripcion |
|---|---|---|
| `GET /api/v1/jugadores/:id/ratings` | autenticado | Historial paginado, del mas reciente al mas antiguo; filtros `system` y `pace` |
| `POST /api/v1/jugadores/:id/ratings` | `rating:update` | Agrega una version `{ system, pace, value, stateCode?, validFrom? }`; responde 201 |

Alias en ingles: `/players/:id/ratings`.

- **Sistemas y ritmos:** `FIDE`, `NATIONAL` y `STATE` (este ultimo lleva `stateCode`, de 2 a 5 letras) en `STANDARD`, `RAPID` y `BLITZ`. El historial solo crece: corregir un valor es registrar otro con vigencia posterior. Un duplicado exacto responde 409 `RATING_DUPLICATE`.
- **Rating del torneo:** `ratingSystem` (por omision `FIDE`), `ratingPace` (`STANDARD`) y `ratingStateCode` indican con que rating se siembra y empareja. Si el jugador no tiene el preferido se usa FIDE, luego nacional y luego estatal del mismo ritmo; en ritmo estandar, como ultimo recurso, la columna `ratingElo`.
- **Desempates:** `domain/tiebreaks` incluye Buchholz, corte 1, mediano 1, Sonneborn-Berger, victorias, victorias con negras, enfrentamiento directo y progresivo; `rankStandings` los aplica en el orden que se le indique.

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
