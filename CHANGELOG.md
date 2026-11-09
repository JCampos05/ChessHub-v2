# Changelog

## [0.1.0-e1.2]

### Agregado
- Entidades de negocio con migracion revisada: categorias, torneos (con vinculo a categorias), rondas, emparejamientos y partidas; el rating Elo es una columna de jugadores.
- CRUD con baja logica (`DELETE` responde 200 con el recurso y es idempotente) para `/categorias`, `/torneos`, `/jugadores`, `/rondas`, `/emparejamientos` y `/partidas`, con alias en ingles (`/categories`, `/tournaments`, `/players`, `/rounds`, `/pairings`, `/games`).
- Vinculo de categorias a torneos: `GET /torneos/:id/categorias` lista, y `PUT` y `DELETE /torneos/:id/categorias/:categoryId` vinculan y desvinculan.
- Listados paginados `{ data, meta }` con ordenamiento permitido por lista blanca y filtros por recurso (texto, estado, fechas, club, rango de rating, torneo, ronda, jugador y resultado).
- Integridad en la base de datos: llaves foraneas RESTRICT, llave compuesta de emparejamientos y partidas hacia rondas, restricciones CHECK (fechas, rangos, mesa, rating) y nombre de categoria unico sin distinguir mayusculas.
- Indices B-Tree: rating y FIDE de jugadores, club, fecha y estado de torneos, y ronda de partidas.
- Emparejamientos: mesa unica por ronda, un jugador por ronda aunque cambie de color, descanso (bye) sin jugador de negras; las escrituras de una ronda se serializan con bloqueo de fila.
- Permisos por rol y ambito evaluados en el servidor para torneos, catalogos, jugadores, rating, rondas y partidas.
- Codigo `REFERENCE_NOT_FOUND` (400) para referencias del cuerpo a registros inexistentes o inactivos, y codigos de conflicto `ROUND_DUPLICATE`, `ROUND_NOT_EDITABLE`, `BOARD_TAKEN`, `PLAYER_ALREADY_PAIRED`, `GAME_DUPLICATE`, `GAME_HAS_RESULT` y `TOURNAMENT_NOT_EDITABLE`.
- Pruebas de integracion por recurso, de concurrencia, de integridad referencial y de uso de indices con `EXPLAIN`.

### Cambiado
- El script `pnpm smoke` evalua el entregable e1.2.
- El rating de jugadores se expone como `ratingElo` y solo se modifica con el permiso de rating.

## [0.1.0-e1.1]

### Agregado
- Estructura del proyecto en TypeScript estricto (ESM), Express 5, Prisma 7 y PostgreSQL 16.
- Entorno Docker: PostgreSQL con volumen persistente, Redis, Mailpit y la API con migraciones al arrancar.
- Validacion de variables de entorno con falla rapida.
- Manejo central de errores con formato uniforme, identificador de peticion y registros sin datos sensibles.
- Autenticacion: registro, inicio de sesion, perfil (`/auth/me`), renovacion de token con rotacion y cierre de sesion.
- Sesiones del lado del servidor, bitacora de accesos, bloqueo tras 5 intentos fallidos y limite de peticiones.
- Catalogo de roles con ambito (federacion, estado, municipio, torneo).
- Jugadores: alta y consulta, con normalizacion de nombres y datos de contacto fuera de la respuesta publica.
- Endpoints de salud y ruta raiz.
- Pruebas unitarias y de integracion contra base de datos real (cobertura global superior al 80 %).
