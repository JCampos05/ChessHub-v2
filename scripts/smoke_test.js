/**
 * ============================================================================
 * SUITE DE PRUEBAS DE HUMO ESCALONADA POR ENTREGABLE (SMOKE TEST)
 * ============================================================================
 * Proyecto: ChessHub – Gestión de Eventos y Torneos de Ajedrez
 * Repositorio: DesarrolloBackend-2026-402/23122854
 * Evaluación Bimodal Institucional · Universidad Autónoma de Sinaloa
 * Profesor Titular: Dr. Herman Geovany Ayala Zúñiga
 * ============================================================================
 * 
 * MODO DE USO:
 *   node scripts/smoke_test.js [--deliverable=<e1.1|e1.2|e2.1|e2.2|e3.1|e3.2|e4.1|e4.2|all>]
 * 
 * EJEMPLOS:
 *   node scripts/smoke_test.js --deliverable=e1.1   # Evalúa solo el hito e1.1 (Arquitectura, Docker, JWT)
 *   node scripts/smoke_test.js --deliverable=e1.2   # Evalúa hitos acumulados hasta e1.2 (Entidades y Catálogos)
 *   node scripts/smoke_test.js --deliverable=e4.2   # Evalúa la suite completa final
 *   node scripts/smoke_test.js                      # Detecta automáticamente el entregable o evalúa e1.1
 */

const http = require('http');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

// Orden cronológico acumulativo de entregables
const ENTREGABLES_ORDEN = ['e1.1', 'e1.2', 'e2.1', 'e2.2', 'e3.1', 'e3.2', 'e4.1', 'e4.2'];

const METADATA_ENTREGABLES = {
  'e1.1': { nombre: 'Arquitectura Limpia, Docker y Autenticación JWT', tag: 'v0.1.0-e1.1' },
  'e1.2': { nombre: 'Entidades de Negocio, Catálogos e Índices B-Tree', tag: 'v0.1.0-e1.2' },
  'e2.1': { nombre: 'Búsqueda Avanzada, Paginación y Caché con Redis', tag: 'v0.2.0-e2.1' },
  'e2.2': { nombre: 'Transacciones Atómicas ACID y Pruebas Automatizadas', tag: 'v0.2.0-e2.2' },
  'e3.1': { nombre: 'Máquina de Estados y Procesamiento Asíncrono BullMQ', tag: 'v0.3.0-e3.1' },
  'e3.2': { nombre: 'Flujo de Eventos, Auditoría Inmutable y CQRS', tag: 'v0.3.0-e3.2' },
  'e4.1': { nombre: 'Módulo de Reportes Analíticos y Worker Threads', tag: 'v0.4.0-e4.1' },
  'e4.2': { nombre: 'Versión Final 1.0.0, OpenAPI/Swagger y Producción', tag: 'v1.0.0-final' }
};

const TODOS_LOS_ENDPOINTS = [
  {
    "path": "/api/v1/health",
    "method": "GET",
    "name": "Salud del Servidor y Conectividad DB/Redis",
    "expected": [
      200
    ],
    "entregable": "e1.1",
    "modulo": "Infraestructura",
    "body": null
  },
  {
    "path": "/",
    "method": "GET",
    "name": "Ruta Raíz del API",
    "expected": [
      200,
      404
    ],
    "entregable": "e1.1",
    "modulo": "Infraestructura",
    "body": null
  },
  {
    "path": "/api/v1/auth/register",
    "method": "POST",
    "name": "Registro de Usuarios (Validación DTO)",
    "expected": [
      201,
      400,
      409,
      422
    ],
    "entregable": "e1.1",
    "modulo": "Seguridad",
    "body": {
      "email": "smoke_test@uas.edu.mx"
    }
  },
  {
    "path": "/api/v1/auth/login",
    "method": "POST",
    "name": "Inicio de Sesión y Emisión JWT",
    "expected": [
      200,
      400,
      401,
      422
    ],
    "entregable": "e1.1",
    "modulo": "Seguridad",
    "body": {
      "email": "smoke_test@uas.edu.mx",
      "password": "bad_password"
    }
  },
  {
    "path": "/api/v1/auth/me",
    "method": "GET",
    "name": "Perfil Protegido por Token Bearer JWT",
    "expected": [
      200,
      401,
      403
    ],
    "entregable": "e1.1",
    "modulo": "Seguridad",
    "body": null
  },
  {
    "path": "/api/v1/auth/refresh-token",
    "method": "POST",
    "name": "Renovación de Credenciales (Refresh Token)",
    "expected": [
      200,
      400,
      401,
      404
    ],
    "entregable": "e1.1",
    "modulo": "Seguridad",
    "body": {
      "refreshToken": "smoke_test_token"
    }
  },
  {
    "path": "/api/v1/torneos",
    "method": "GET",
    "name": "Catálogo de Torneo (Listado y Paginación)",
    "expected": [
      200,
      401,
      403
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Torneo",
    "body": null
  },
  {
    "path": "/api/v1/torneos",
    "method": "POST",
    "name": "Creación de Torneo (Validación de Payload)",
    "expected": [
      201,
      400,
      401,
      403,
      409,
      422
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Torneo",
    "body": {}
  },
  {
    "path": "/api/v1/torneos/1",
    "method": "GET",
    "name": "Detalle Individual de Torneo por ID",
    "expected": [
      200,
      401,
      403,
      404
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Torneo",
    "body": null
  },
  {
    "path": "/api/v1/torneos/1",
    "method": "PATCH",
    "name": "Actualización de Atributos de Torneo",
    "expected": [
      200,
      400,
      401,
      403,
      404,
      422
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Torneo",
    "body": {}
  },
  {
    "path": "/api/v1/torneos/1",
    "method": "DELETE",
    "name": "Baja Lógica de Torneo",
    "expected": [
      200,
      204,
      401,
      403,
      404
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Torneo",
    "body": null
  },
  {
    "path": "/api/v1/categorias",
    "method": "GET",
    "name": "Catálogo de Categoria (Listado y Paginación)",
    "expected": [
      200,
      401,
      403
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Categoria",
    "body": null
  },
  {
    "path": "/api/v1/categorias",
    "method": "POST",
    "name": "Creación de Categoria (Validación de Payload)",
    "expected": [
      201,
      400,
      401,
      403,
      409,
      422
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Categoria",
    "body": {}
  },
  {
    "path": "/api/v1/categorias/1",
    "method": "GET",
    "name": "Detalle Individual de Categoria por ID",
    "expected": [
      200,
      401,
      403,
      404
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Categoria",
    "body": null
  },
  {
    "path": "/api/v1/categorias/1",
    "method": "PATCH",
    "name": "Actualización de Atributos de Categoria",
    "expected": [
      200,
      400,
      401,
      403,
      404,
      422
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Categoria",
    "body": {}
  },
  {
    "path": "/api/v1/categorias/1",
    "method": "DELETE",
    "name": "Baja Lógica de Categoria",
    "expected": [
      200,
      204,
      401,
      403,
      404
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Categoria",
    "body": null
  },
  {
    "path": "/api/v1/jugadores",
    "method": "GET",
    "name": "Catálogo de Jugador (Listado y Paginación)",
    "expected": [
      200,
      401,
      403
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Jugador",
    "body": null
  },
  {
    "path": "/api/v1/jugadores",
    "method": "POST",
    "name": "Creación de Jugador (Validación de Payload)",
    "expected": [
      201,
      400,
      401,
      403,
      409,
      422
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Jugador",
    "body": {}
  },
  {
    "path": "/api/v1/jugadores/1",
    "method": "GET",
    "name": "Detalle Individual de Jugador por ID",
    "expected": [
      200,
      401,
      403,
      404
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Jugador",
    "body": null
  },
  {
    "path": "/api/v1/jugadores/1",
    "method": "PATCH",
    "name": "Actualización de Atributos de Jugador",
    "expected": [
      200,
      400,
      401,
      403,
      404,
      422
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Jugador",
    "body": {}
  },
  {
    "path": "/api/v1/jugadores/1",
    "method": "DELETE",
    "name": "Baja Lógica de Jugador",
    "expected": [
      200,
      204,
      401,
      403,
      404
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Jugador",
    "body": null
  },
  {
    "path": "/api/v1/rondas",
    "method": "GET",
    "name": "Catálogo de Ronda (Listado y Paginación)",
    "expected": [
      200,
      401,
      403
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Ronda",
    "body": null
  },
  {
    "path": "/api/v1/rondas",
    "method": "POST",
    "name": "Creación de Ronda (Validación de Payload)",
    "expected": [
      201,
      400,
      401,
      403,
      409,
      422
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Ronda",
    "body": {}
  },
  {
    "path": "/api/v1/rondas/1",
    "method": "GET",
    "name": "Detalle Individual de Ronda por ID",
    "expected": [
      200,
      401,
      403,
      404
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Ronda",
    "body": null
  },
  {
    "path": "/api/v1/rondas/1",
    "method": "PATCH",
    "name": "Actualización de Atributos de Ronda",
    "expected": [
      200,
      400,
      401,
      403,
      404,
      422
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Ronda",
    "body": {}
  },
  {
    "path": "/api/v1/rondas/1",
    "method": "DELETE",
    "name": "Baja Lógica de Ronda",
    "expected": [
      200,
      204,
      401,
      403,
      404
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Ronda",
    "body": null
  },
  {
    "path": "/api/v1/partidas",
    "method": "GET",
    "name": "Catálogo de Partida (Listado y Paginación)",
    "expected": [
      200,
      401,
      403
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Partida",
    "body": null
  },
  {
    "path": "/api/v1/partidas",
    "method": "POST",
    "name": "Creación de Partida (Validación de Payload)",
    "expected": [
      201,
      400,
      401,
      403,
      409,
      422
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Partida",
    "body": {}
  },
  {
    "path": "/api/v1/partidas/1",
    "method": "GET",
    "name": "Detalle Individual de Partida por ID",
    "expected": [
      200,
      401,
      403,
      404
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Partida",
    "body": null
  },
  {
    "path": "/api/v1/partidas/1",
    "method": "PATCH",
    "name": "Actualización de Atributos de Partida",
    "expected": [
      200,
      400,
      401,
      403,
      404,
      422
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Partida",
    "body": {}
  },
  {
    "path": "/api/v1/partidas/1",
    "method": "DELETE",
    "name": "Baja Lógica de Partida",
    "expected": [
      200,
      204,
      401,
      403,
      404
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Partida",
    "body": null
  },
  {
    "path": "/api/v1/emparejamientos",
    "method": "GET",
    "name": "Catálogo de Emparejamiento (Listado y Paginación)",
    "expected": [
      200,
      401,
      403
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Emparejamiento",
    "body": null
  },
  {
    "path": "/api/v1/emparejamientos",
    "method": "POST",
    "name": "Creación de Emparejamiento (Validación de Payload)",
    "expected": [
      201,
      400,
      401,
      403,
      409,
      422
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Emparejamiento",
    "body": {}
  },
  {
    "path": "/api/v1/emparejamientos/1",
    "method": "GET",
    "name": "Detalle Individual de Emparejamiento por ID",
    "expected": [
      200,
      401,
      403,
      404
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Emparejamiento",
    "body": null
  },
  {
    "path": "/api/v1/emparejamientos/1",
    "method": "PATCH",
    "name": "Actualización de Atributos de Emparejamiento",
    "expected": [
      200,
      400,
      401,
      403,
      404,
      422
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Emparejamiento",
    "body": {}
  },
  {
    "path": "/api/v1/emparejamientos/1",
    "method": "DELETE",
    "name": "Baja Lógica de Emparejamiento",
    "expected": [
      200,
      204,
      401,
      403,
      404
    ],
    "entregable": "e1.2",
    "modulo": "Entidades: Emparejamiento",
    "body": null
  },
  {
    "path": "/api/v1/jugadores?ratingMin=1&club=1",
    "method": "GET",
    "name": "Búsqueda con Filtros (/api/v1/jugadores)",
    "expected": [
      200,
      400,
      401,
      403
    ],
    "entregable": "e2.1",
    "modulo": "Búsqueda y Filtros",
    "body": null
  },
  {
    "path": "/api/v1/jugadores?page=1&limit=10&sortBy=id&order=DESC",
    "method": "GET",
    "name": "Paginación Estructurada (/api/v1/jugadores)",
    "expected": [
      200,
      400,
      401,
      403
    ],
    "entregable": "e2.1",
    "modulo": "Búsqueda y Filtros",
    "body": null
  },
  {
    "path": "/api/v1/torneos?estado=1",
    "method": "GET",
    "name": "Búsqueda con Filtros (/api/v1/torneos)",
    "expected": [
      200,
      400,
      401,
      403
    ],
    "entregable": "e2.1",
    "modulo": "Búsqueda y Filtros",
    "body": null
  },
  {
    "path": "/api/v1/torneos?page=1&limit=10&sortBy=id&order=DESC",
    "method": "GET",
    "name": "Paginación Estructurada (/api/v1/torneos)",
    "expected": [
      200,
      400,
      401,
      403
    ],
    "entregable": "e2.1",
    "modulo": "Búsqueda y Filtros",
    "body": null
  },
  {
    "path": "/api/v1/torneos/1/inscripciones",
    "method": "POST",
    "name": "Operación Transaccional ACID: POST /api/v1/torneos/:id/inscripciones",
    "expected": [
      201,
      409,
      401,
      403
    ],
    "entregable": "e2.2",
    "modulo": "Transacciones ACID",
    "body": {}
  },
  {
    "path": "/api/v1/torneos/1/rondas/generar",
    "method": "POST",
    "name": "Operación Transaccional ACID: POST /api/v1/torneos/:id/rondas/generar",
    "expected": [
      201,
      409,
      401,
      403
    ],
    "entregable": "e2.2",
    "modulo": "Transacciones ACID",
    "body": {}
  },
  {
    "path": "/api/v1/torneos/1/estado",
    "method": "PATCH",
    "name": "Transición General en Torneo",
    "expected": [
      200,
      400,
      401,
      403,
      404,
      422
    ],
    "entregable": "e3.1",
    "modulo": "Máquina de Estados",
    "body": {
      "estado": "CONFIRMADO"
    }
  },
  {
    "path": "/api/v1/torneos/1/convocatoria",
    "method": "PATCH",
    "name": "Transición a 'Convocatoria' en Torneo",
    "expected": [
      200,
      400,
      401,
      403,
      404,
      422
    ],
    "entregable": "e3.1",
    "modulo": "Máquina de Estados",
    "body": {}
  },
  {
    "path": "/api/v1/torneos/1/inscripciones_cerradas",
    "method": "PATCH",
    "name": "Transición a 'Inscripciones_Cerradas' en Torneo",
    "expected": [
      200,
      400,
      401,
      403,
      404,
      422
    ],
    "entregable": "e3.1",
    "modulo": "Máquina de Estados",
    "body": {}
  },
  {
    "path": "/api/v1/torneos/1/en_juego",
    "method": "PATCH",
    "name": "Transición a 'En_Juego' en Torneo",
    "expected": [
      200,
      400,
      401,
      403,
      404,
      422
    ],
    "entregable": "e3.1",
    "modulo": "Máquina de Estados",
    "body": {}
  },
  {
    "path": "/api/v1/torneos/1/ronda_en_curso",
    "method": "PATCH",
    "name": "Transición a 'Ronda_En_Curso' en Torneo",
    "expected": [
      200,
      400,
      401,
      403,
      404,
      422
    ],
    "entregable": "e3.1",
    "modulo": "Máquina de Estados",
    "body": {}
  },
  {
    "path": "/api/v1/torneos/1/finalizado",
    "method": "PATCH",
    "name": "Transición a 'Finalizado' en Torneo",
    "expected": [
      200,
      400,
      401,
      403,
      404,
      422
    ],
    "entregable": "e3.1",
    "modulo": "Máquina de Estados",
    "body": {}
  },
  {
    "path": "/api/v1/torneos/1/cancelado",
    "method": "PATCH",
    "name": "Transición a 'Cancelado' en Torneo",
    "expected": [
      200,
      400,
      401,
      403,
      404,
      422
    ],
    "entregable": "e3.1",
    "modulo": "Máquina de Estados",
    "body": {}
  },
  {
    "path": "/api/v1/notificaciones",
    "method": "GET",
    "name": "Bandeja de Notificaciones Asíncronas (BullMQ)",
    "expected": [
      200,
      401,
      403,
      404
    ],
    "entregable": "e3.1",
    "modulo": "Notificaciones",
    "body": null
  },
  {
    "path": "/api/v1/notificaciones/unread-count",
    "method": "GET",
    "name": "Conteo de Notificaciones No Leídas",
    "expected": [
      200,
      401,
      403,
      404
    ],
    "entregable": "e3.1",
    "modulo": "Notificaciones",
    "body": null
  },
  {
    "path": "/api/v1/audit-logs",
    "method": "GET",
    "name": "Bitácora Histórica Inmutable (Audit Log)",
    "expected": [
      200,
      401,
      403,
      404
    ],
    "entregable": "e3.2",
    "modulo": "Auditoría y Trazabilidad",
    "body": null
  },
  {
    "path": "/api/v1/eventos",
    "method": "GET",
    "name": "Registro de Eventos de Dominio (CDC)",
    "expected": [
      200,
      401,
      403,
      404
    ],
    "entregable": "e3.2",
    "modulo": "Auditoría y Trazabilidad",
    "body": null
  },
  {
    "path": "/api/v1/reportes/analitica",
    "method": "GET",
    "name": "Módulo de Reportes Analíticos (Worker Threads)",
    "expected": [
      200,
      401,
      403,
      404
    ],
    "entregable": "e4.1",
    "modulo": "Módulo de Reportes",
    "body": null
  },
  {
    "path": "/api/v1/reportes/balance",
    "method": "GET",
    "name": "Reporte de Balance y Rendimiento Agregado",
    "expected": [
      200,
      401,
      403,
      404
    ],
    "entregable": "e4.1",
    "modulo": "Módulo de Reportes",
    "body": null
  },
  {
    "path": "/api/v1/reportes/exportar/excel",
    "method": "GET",
    "name": "Exportación de Reporte a Excel (.xlsx)",
    "expected": [
      200,
      401,
      403,
      404
    ],
    "entregable": "e4.1",
    "modulo": "Módulo de Reportes",
    "body": null
  },
  {
    "path": "/api/v1/reportes/exportar/pdf",
    "method": "GET",
    "name": "Exportación de Reporte a PDF",
    "expected": [
      200,
      401,
      403,
      404
    ],
    "entregable": "e4.1",
    "modulo": "Módulo de Reportes",
    "body": null
  },
  {
    "path": "/api/v1/reportes/clasificacion",
    "method": "GET",
    "name": "Reporte Específico: /api/v1/reportes/clasificacion",
    "expected": [
      200,
      401,
      403,
      404
    ],
    "entregable": "e4.1",
    "modulo": "Módulo de Reportes",
    "body": null
  },
  {
    "path": "/api/docs",
    "method": "GET",
    "name": "Documentación Interactiva Swagger UI / OpenAPI 3.0",
    "expected": [
      200,
      301,
      302
    ],
    "entregable": "e4.2",
    "modulo": "Documentación Final",
    "body": null
  },
  {
    "path": "/api/docs-json",
    "method": "GET",
    "name": "Esquema OpenAPI en Formato JSON",
    "expected": [
      200,
      301,
      302,
      404
    ],
    "entregable": "e4.2",
    "modulo": "Documentación Final",
    "body": null
  }
];

// Parse CLI args
const rawArgs = process.argv.slice(2);
let deliverableArg = null;

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a.startsWith('--deliverable=')) deliverableArg = a.split('=')[1];
  else if (a === '--deliverable' && rawArgs[i + 1]) deliverableArg = rawArgs[i + 1];
  else if (a === '--all' || a === '-a') deliverableArg = 'all';
  else if (ENTREGABLES_ORDEN.includes(a.toLowerCase())) deliverableArg = a.toLowerCase();
}

if (!deliverableArg) {
  deliverableArg = process.env.DELIVERABLE || 'e1.1';
}

deliverableArg = deliverableArg.toLowerCase();
if (deliverableArg !== 'all' && !ENTREGABLES_ORDEN.includes(deliverableArg)) {
  console.error(`Entregable no válido: '${deliverableArg}'. Opciones válidas: ${ENTREGABLES_ORDEN.join(', ')}, all`);
  process.exit(1);
}

// Filtrar endpoints acumulativos hasta el entregable seleccionado
function filterEndpoints(target) {
  if (target === 'all' || target === 'e4.2') {
    return TODOS_LOS_ENDPOINTS;
  }
  const maxIdx = ENTREGABLES_ORDEN.indexOf(target);
  const permitidos = ENTREGABLES_ORDEN.slice(0, maxIdx + 1);
  return TODOS_LOS_ENDPOINTS.filter(ep => permitidos.includes(ep.entregable));
}

const endpointsAEvaluar = filterEndpoints(deliverableArg);

function executeRequest(endpoint) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const payload = endpoint.body ? JSON.stringify(endpoint.body) : null;

    const options = {
      hostname: HOST,
      port: PORT,
      path: endpoint.path,
      method: endpoint.method,
      timeout: 3500,
      headers: {
        'User-Agent': 'SmokeTest-UAS-Bimodal/Staged',
        'Accept': 'application/json, text/html, */*'
      }
    };

    if (payload) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const durationMs = Date.now() - startTime;
        const passed = endpoint.expected.includes(res.statusCode);
        resolve({
          path: endpoint.path,
          method: endpoint.method,
          name: endpoint.name,
          modulo: endpoint.modulo,
          entregable: endpoint.entregable,
          status: res.statusCode,
          expected: endpoint.expected,
          durationMs,
          passed
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        path: endpoint.path,
        method: endpoint.method,
        name: endpoint.name,
        modulo: endpoint.modulo,
        entregable: endpoint.entregable,
        error: err.code || err.message,
        expected: endpoint.expected,
        passed: false
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        path: endpoint.path,
        method: endpoint.method,
        name: endpoint.name,
        modulo: endpoint.modulo,
        entregable: endpoint.entregable,
        error: 'TIMEOUT (excedió 3500ms)',
        expected: endpoint.expected,
        passed: false
      });
    });

    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runSuite() {
  const meta = METADATA_ENTREGABLES[deliverableArg] || { nombre: 'Evaluación Integral Acumulada', tag: 'v1.0.0-final' };

  console.log('\n' + '='.repeat(82));
  console.log('   SUITE DE PRUEBAS DE HUMO ESCALONADA POR ENTREGABLE · DESARROLLO BACKEND');
  console.log('='.repeat(82));
  console.log('  * Proyecto Asignado:   ChessHub – Gestión de Eventos y Torneos de Ajedrez');
  console.log('  * Repositorio Oficial: DesarrolloBackend-2026-402/23122854');
  console.log('  * Host Evaluado:       http://' + HOST + ':' + PORT);
  console.log('  * Entregable Objetivo: [' + deliverableArg.toUpperCase() + '] ' + meta.nombre);
  console.log('  * Tag Reglamentario:   ' + meta.tag);
  console.log('  * Endpoints en Fase:   ' + endpointsAEvaluar.length + ' de ' + TODOS_LOS_ENDPOINTS.length + ' totales del proyecto');
  console.log('='.repeat(82) + '\n');

  let passedTotal = 0;
  let currentFase = '';

  for (let i = 0; i < endpointsAEvaluar.length; i++) {
    const ep = endpointsAEvaluar[i];
    if (ep.entregable !== currentFase) {
      currentFase = ep.entregable;
      const faseMeta = METADATA_ENTREGABLES[currentFase];
      console.log(`\n--- [FASE ${currentFase.toUpperCase()}: ${faseMeta ? faseMeta.nombre.toUpperCase() : ''}] ---`);
    }

    const res = await executeRequest(ep);
    const num = (i + 1).toString().padStart(2, '0');

    if (res.passed) {
      passedTotal++;
      console.log(`  [✓ APROBADO] #${num} [${res.entregable}] ${res.method.padEnd(6)} ${res.path.padEnd(38)} -> HTTP ${res.status} (${res.durationMs}ms)`);
    } else {
      const motivo = res.error ? res.error : `HTTP ${res.status} (Esperaba: ${res.expected.join(', ')})`;
      console.log(`  [✗ FALLO]    #${num} [${res.entregable}] ${res.method.padEnd(6)} ${res.path.padEnd(38)} -> ${motivo}`);
      console.log(`                 Detalle: ${res.name}`);
    }

    await sleep(10);
  }

  const score = Math.round((passedTotal / endpointsAEvaluar.length) * 100);

  console.log('\n' + '='.repeat(82));
  console.log('                    RESUMEN DE EVALUACIÓN: ENTREGABLE ' + deliverableArg.toUpperCase());
  console.log('='.repeat(82));
  console.log(`  * Endpoints superados:   ${passedTotal} de ${endpointsAEvaluar.length} aplicables a este hito (${score}%)`);
  console.log(`  * Calificación Obtenida: ${score} / 100 puntos`);
  console.log('-'.repeat(82));

  if (score >= 80) {
    console.log(`  [ESTADO: APROBADO] ✅ El backend cumple satisfactoriamente los requerimientos de ${deliverableArg.toUpperCase()}.`);
    console.log('  Listo para publicar el tag y release reglamentario en GitHub:');
    console.log('    git add .');
    console.log(`    git commit -m "feat: completar requerimientos de entregable ${deliverableArg}"`);
    console.log(`    git tag -a ${meta.tag} -m "Release Entregable ${deliverableArg} (${meta.nombre})"`);
    console.log('    git push origin main --tags\n');
    process.exit(0);
  } else {
    console.log('  [ESTADO: REVISIÓN REQUERIDA] ⚠️  Calificación inferior al umbral mínimo reglamentario (80 pts).');
    console.log('  Acciones recomendadas:');
    console.log('    1. Asegúrese de que los servicios de Docker estén corriendo: docker compose ps');
    console.log('    2. Revise los endpoints con fallo arriba marcados con [✗ FALLO].');
    console.log('    3. Corrija las rutas o códigos HTTP devueltos y vuelva a ejecutar.');
    console.log('='.repeat(82) + '\n');
    process.exit(1);
  }
}

runSuite();
