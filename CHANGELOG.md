# Changelog

## [0.3.0-e3.1]

### Agregado
- Maquina de estados del torneo (`domain/state-machines`): convocatoria, inscripciones cerradas, en juego, ronda en curso, finalizado y cancelado, con las transiciones validas y sus condiciones (al menos 2 inscritos para iniciar, una ronda con mesas para ponerla en curso, partidas con resultado para cerrarla y rondas terminadas para finalizar). Finalizado y cancelado no tienen salida.
- `PATCH /torneos/:id/estado` (alias `/tournaments/:id/status`) con `{ estado, motivo? }`, donde el estado puede ir como codigo, nombre en espanol o numero del ciclo, y las rutas por nombre `/convocatoria`, `/inscripciones_cerradas`, `/en_juego`, `/ronda_en_curso`, `/finalizado` y `/cancelado`. Requieren `tournament:update` sobre el torneo.
- `GET /torneos/:id/historial-estados` (alias `/status-history`): cambios de estado paginados, del mas reciente al mas antiguo, con actor y motivo.
- La transicion se aplica en una sola transaccion con el torneo bloqueado: estado, efecto sobre la ronda (inicio o cierre), historial y encolado del aviso. Veinte peticiones simultaneas a la misma transicion dan un solo 200.
- Notificaciones: `GET /notificaciones` (alias `/notifications`, filtro `leida`), `GET /notificaciones/unread-count`, `PATCH /notificaciones/:id/leida` y `PATCH /notificaciones/leer-todas`. Solo se ven y modifican las propias; una ajena responde 404.
- Cola de notificaciones: BullMQ sobre Redis cuando hay `REDIS_URL` y cola en memoria sin ella. El trabajo se encola dentro de la transaccion; si la cola no responde en 2 s, la transaccion se revierte y la API responde 503 `QUEUE_UNAVAILABLE`. El consumidor es idempotente (reintentos con espera exponencial, sin filas ni correos duplicados) y avisa al creador del torneo y a quien tiene un rol con ambito de ese torneo.
- Correo opcional de cada aviso con Nodemailer (`MAIL_ENABLED`, `SMTP_*`).
- Consumidor integrado en el servidor (`WORKER_ENABLED`) y proceso independiente con `pnpm worker` y `pnpm worker:start`; cierre ordenado antes de Redis y Prisma.
- Variables `WORKER_ENABLED`, `NOTIFICATION_ATTEMPTS`, `NOTIFICATION_BACKOFF_MS` y `MAIL_ENABLED`.
- Codigos `INVALID_STATE_TRANSITION` y `STATE_PRECONDITION_FAILED` (422), `TOURNAMENT_NOT_IN_PROGRESS` (409) y `QUEUE_UNAVAILABLE` (503).
- Migracion de historial de estados y notificaciones: tablas `state_changes` y `notifications`, unico `(user_id, dedupe_key)`, indice parcial de no leidas y restricciones CHECK.
- Pruebas de transiciones, concurrencia, reversion (fallo del encolado y del historial, incluido el efecto sobre la ronda), aislamiento por ambito de las siete rutas de estado y de las notificaciones, y cola BullMQ contra un Redis real.
- El flujo de integracion continua suma un servicio Redis 7 y `TEST_REDIS_URL` para ejecutar la prueba de BullMQ real.
- Ratings por sistema (FIDE, nacional y estatal) y ritmo (estandar, rapido y blitz) con historial de solo insercion: `GET` y `POST /jugadores/:id/ratings` (alias `/players/:id/ratings`). Lectura para cualquier usuario autenticado; el alta requiere el permiso `rating:update`.
- El torneo declara el rating con el que se siembra y empareja: `ratingSystem` (FIDE por omision), `ratingPace` (STANDARD por omision) y `ratingStateCode`. Si falta el valor preferido se respalda en FIDE, nacional y estatal del mismo ritmo, y en ritmo estandar en la columna `ratingElo`.
- Desempates puros en `domain/tiebreaks`: Buchholz, Buchholz corte 1, Buchholz mediano 1, Sonneborn-Berger, victorias, victorias con negras, enfrentamiento directo y puntaje progresivo, con orden configurable y posiciones compartidas (`rankStandings`).
- Codigo de conflicto `RATING_DUPLICATE`.
- Migracion `player_ratings`: tabla de ratings con restricciones CHECK e indice unico por version, y preferencia de rating en torneos.
- Integracion continua con GitHub Actions: tipos, pruebas con cobertura contra PostgreSQL 16, compilacion y construccion de la imagen de Docker en cada push, etiqueta y pull request.

### Cambiado
- La generacion de rondas siembra con el rating configurado en el torneo en lugar de solo la columna `ratingElo`.
- Generar una ronda exige el torneo en juego: con una ronda en curso o antes de iniciar responde 409 `TOURNAMENT_NOT_IN_PROGRESS`.
- El script `pnpm smoke` evalua el entregable e3.1.

## [0.2.0-e2.2]

### Agregado
- Inscripciones por torneo y categoria: `POST`, `GET`, `DELETE` y `PATCH …/pago` bajo `/torneos/:id/inscripciones` (alias `/tournaments/:id/registrations`; los campos aceptan `jugadorId` y `categoriaId`).
- Cupo atomico: el cupo y el folio se reservan con una sola sentencia `UPDATE` condicional en la base, de modo que nunca se supera `max_players`; un fallo posterior revierte el cupo y el folio en la misma transaccion.
- Folio consecutivo por torneo, unico y sin reutilizarse al cancelar; una sola inscripcion activa por jugador y torneo (indice unico parcial); cancelar libera el cupo y permite reinscribirse.
- Elegibilidad: torneo en convocatoria, categoria vinculada, jugador no inactivo y edad cumplida a la fecha de inicio dentro del rango de la categoria.
- Pago de la inscripcion (`PENDING` a `CONFIRMED`) con el permiso `payment:confirm`; el permiso `registration:manage` rige el alta, el listado y la cancelacion.
- `POST /torneos/:id/rondas/generar` (alias `/tournaments/:id/rounds/generate`): cierra la ronda anterior y genera la siguiente en una sola transaccion con el torneo bloqueado; crea las mesas con origen `AUTO` y una partida pendiente por mesa.
- Emparejamiento suizo puro y determinista (`domain/swiss`): grupos de puntaje, flotadores al grupo mas cercano, balance de color de -2 a +2 sin tres colores iguales seguidos, descanso (bye) unico por jugador, sin rivales repetidos y con tope de busqueda.
- Buchholz basico (`domain/tiebreaks`) para ordenar dentro de cada grupo de puntaje.
- Codigos de conflicto: `CAPACITY_FULL`, `ALREADY_REGISTERED`, `REGISTRATION_CLOSED`, `AGE_NOT_ELIGIBLE`, `CAPACITY_BELOW_REGISTERED`, `PAYMENT_ALREADY_CONFIRMED`, `REGISTRATION_CANCELLED`, `NOT_ENOUGH_PLAYERS`, `PREVIOUS_ROUND_UNFINISHED`, `ROUNDS_COMPLETE` y `NO_VALID_PAIRING`.
- El torneo expone `registeredCount`; el emparejamiento expone `origin` (`MANUAL` o `AUTO`).
- Migracion `registrations_and_rounds`: tabla `registrations`, contadores de cupo y folio en torneos con restricciones CHECK, y origen de las mesas.
- Pruebas de concurrencia (20 peticiones por el ultimo cupo, 50 folios simultaneos, generaciones simultaneas) y de rollback con fallos forzados.

### Cambiado
- Un torneo no admite bajar `max_players` por debajo de las inscripciones activas.
- El script `pnpm smoke` evalua el entregable e2.2.

## [0.2.0-e2.1]

### Agregado
- Busqueda avanzada de jugadores: `q` (nombre o FIDE), `fideId`, `sex`, `edadMin` y `edadMax` (edad cumplida), `ratingMin`, `ratingMax` y valores multiples en `status`, `club` y `federation`.
- Filtros de torneos: `ciudad`, `categoryId`, `abiertas` (inscripcion abierta y aun sin iniciar), `desde`, `hasta` y valores multiples en `estado`; nuevos campos de ordenamiento (`name`, `startDate`, `endDate`, `city`, `createdAt`).
- Filtro `edad` en `/categorias`: devuelve las categorias cuyo rango de edades incluye esa edad.
- Valores multiples separados por coma, con maximo 10 por filtro; un valor invalido o de mas responde 422.
- Cache de lecturas con Redis y respaldo LRU en memoria del proceso: listados y detalle de torneos y categorias, y la vista publica del listado de jugadores. Se invalida en cada escritura y nunca guarda datos de contacto.
- Si Redis no responde, la API sigue funcionando con la cache en memoria o consultando la base; un fallo de cache no produce errores HTTP.
- `/health` informa el estado de Redis (`up` o `down`) sin devolver 503 cuando solo falla la cache.
- Variables `REDIS_URL`, `CACHE_TTL_SECONDS` y `CACHE_LRU_CAPACITY`.
- Migracion `search_indexes`: extension `pg_trgm`, indices GIN de trigramas para nombre de jugador y nombre, sede y ciudad de torneo, e indice por fecha de nacimiento.
- Pruebas de planes `EXPLAIN` con tablas grandes y prueba de rendimiento con 50 000 jugadores y 5 000 torneos: p95 menor a 200 ms sin cache y menor a 50 ms con cache.

### Cambiado
- El script `pnpm smoke` evalua el entregable e2.1.

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
