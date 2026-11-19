/**
 * Pruebas de carga con k6 contra la API de ChessHub.
 *
 * Ejecucion:
 *   k6 run scripts/k6_load_test.js
 *   k6 run -e TARGET_URL=http://localhost:3000 -e K6_EMAIL=admin@chesshub.local -e K6_PASSWORD=... scripts/k6_load_test.js
 *
 * La sesion se inicia una sola vez en setup() y todas las peticiones llevan el token Bearer,
 * de modo que se mide el acceso real a la base de datos y a la cache, no el rechazo del middleware.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '15s', target: 20 }, // calentamiento
    { duration: '30s', target: 100 }, // carga sostenida
    { duration: '10s', target: 250 }, // pico de estres
    { duration: '15s', target: 0 }, // enfriamiento
  ],
  thresholds: {
    // 95 % de las peticiones en menos de 200 ms y menos de 1 % de errores
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';
const EMAIL = __ENV.K6_EMAIL || 'admin@chesshub.local';
const PASSWORD = __ENV.K6_PASSWORD || 'Admin12345';

// Inicia sesion una vez y comparte el token con todos los usuarios virtuales
export function setup() {
  const res = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({ email: EMAIL, password: PASSWORD }), {
    headers: { 'Content-Type': 'application/json' },
  });

  const ok = check(res, {
    'inicio de sesion responde 200': (r) => r.status === 200,
    'inicio de sesion entrega un token': (r) => Boolean(r.json('token')),
  });
  if (!ok) {
    throw new Error(`No se pudo iniciar sesion con ${EMAIL} (HTTP ${res.status}); sin token la prueba no mide la base de datos`);
  }

  return { token: res.json('token') };
}

export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.token}`,
  };

  // 1. Disponibilidad
  const health = http.get(`${BASE_URL}/api/v1/health`);
  check(health, {
    'salud responde 200': (r) => r.status === 200,
  });

  // 2. Listado de torneos (lectura intensiva con cache)
  const tournaments = http.get(`${BASE_URL}/api/v1/torneos?page=1&limit=20`, { headers });
  check(tournaments, {
    'listado de torneos responde 200': (r) => r.status === 200,
    'listado de torneos trae data y meta': (r) => Array.isArray(r.json('data')) && r.json('meta') !== null,
  });

  // 3. Busqueda con filtros (indices de la base de datos)
  const players = http.get(`${BASE_URL}/api/v1/jugadores?ratingMin=1000&limit=10`, { headers });
  check(players, {
    'busqueda de jugadores responde 200': (r) => r.status === 200,
  });

  // 4. Bandeja propia de notificaciones
  const inbox = http.get(`${BASE_URL}/api/v1/notificaciones/unread-count`, { headers });
  check(inbox, {
    'conteo de notificaciones responde 200': (r) => r.status === 200,
  });

  sleep(1);
}
