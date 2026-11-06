# Changelog

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
