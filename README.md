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

```bash
pnpm install
docker compose up -d postgres redis mailpit
pnpm exec prisma generate
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

## Estructura

```
src/
  config/        variables de entorno validadas
  lib/           prisma, logger
  shared/        errores, validacion, paginacion
  middlewares/   autenticacion, limite de peticiones, errores
  domain/        logica pura (coincidencia de nombres)
  modules/       auth, users, players, health
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

Los errores tienen la forma `{ status, statusCode, code, message, errors? }`.

## Seguridad

- Contrasenas con bcrypt (costo 12; 4 solo con `NODE_ENV=test`).
- JWT con sesion verificada en base de datos en cada peticion.
- Refresh token con rotacion y deteccion de reutilizacion.
- Bloqueo temporal tras 5 intentos fallidos y limite de peticiones.
- Los datos de contacto de jugadores no salen en respuestas publicas.
