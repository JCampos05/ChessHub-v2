import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { bearer, sessionWithRole } from '../helpers/auth.js';
import { seedBulkData } from '../helpers/bulk-data.js';
import { prisma, resetDb } from '../helpers/db.js';

// Con 50 000 jugadores y 5 000 torneos, el percentil 95 de los listados con filtros es menor
// a 200 ms sin caché y menor a 50 ms con caché. Se mide por la API completa.

const PLAYERS = 50_000;
const TOURNAMENTS = 5_000;
const SAMPLES = 100;
const P95_UNCACHED_MS = 200;
const P95_CACHED_MS = 50;

const app = createApp();

const randomInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;

function percentile95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
}

async function measure(token: string, urls: string[]): Promise<number> {
  const times: number[] = [];
  for (const url of urls) {
    const start = performance.now();
    const res = await request(app).get(url).set(...bearer(token));
    times.push(performance.now() - start);
    expect(res.status).toBe(200);
  }
  return percentile95(times);
}

// Cada URL es distinta, así que ninguna puede resolverse desde la caché
const distinct = (build: () => string): string[] => {
  const urls = new Set<string>();
  while (urls.size < SAMPLES) urls.add(build());
  return [...urls];
};

const sameUrl = (url: string): string[] => Array.from({ length: SAMPLES }, () => url);

describe(`rendimiento de los listados con ${PLAYERS} jugadores y ${TOURNAMENTS} torneos (RNF02, RF13)`, () => {
  let token: string;

  beforeAll(async () => {
    await resetDb();
    token = (await sessionWithRole(app)).token;
    await seedBulkData({ players: PLAYERS, tournaments: TOURNAMENTS });
  }, 180_000);

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  const scenarios = [
    {
      name: 'jugadores por rango de rating y club',
      cold: () => {
        const min = randomInt(800, 2700);
        return `/api/v1/jugadores?ratingMin=${min}&ratingMax=${min + randomInt(5, 60)}&club=CLUB${randomInt(0, 49)}`;
      },
      warm: '/api/v1/jugadores?ratingMin=1500&ratingMax=1600&club=CLUB7',
    },
    {
      name: 'jugadores por texto',
      cold: () => `/api/v1/jugadores?q=${Math.random().toString(16).slice(2, 8)}`,
      warm: '/api/v1/jugadores?q=a3f9c2',
    },
    {
      name: 'jugadores por edad y estado',
      cold: () => {
        const min = randomInt(6, 60);
        return `/api/v1/jugadores?edadMin=${min}&edadMax=${min + randomInt(0, 5)}&status=ACTIVE&page=${randomInt(1, 30)}`;
      },
      warm: '/api/v1/jugadores?edadMin=10&edadMax=12&status=ACTIVE',
    },
    {
      name: 'torneos por estado y fechas',
      cold: () => {
        const from = new Date(Date.UTC(2020, 0, 1) + randomInt(0, 2000) * 86_400_000).toISOString().slice(0, 10);
        return `/api/v1/torneos?estado=${randomInt(1, 6)}&desde=${from}&page=${randomInt(1, 20)}`;
      },
      warm: '/api/v1/torneos?estado=3,4&desde=2021-01-01',
    },
    {
      name: 'torneos paginados',
      cold: () => `/api/v1/torneos?page=${randomInt(1, 450)}&limit=10&sortBy=startDate&order=DESC`,
      warm: '/api/v1/torneos?page=1&limit=10&sortBy=startDate&order=DESC',
    },
  ];

  it.each(scenarios)('$name: p95 sin caché menor a 200 ms', async ({ cold }) => {
    const p95 = await measure(token, distinct(cold));
    expect(p95).toBeLessThan(P95_UNCACHED_MS);
  }, 60_000);

  it.each(scenarios)('$name: p95 con caché menor a 50 ms', async ({ warm }) => {
    await request(app).get(warm).set(...bearer(token)).expect(200);
    const p95 = await measure(token, sameUrl(warm));
    expect(p95).toBeLessThan(P95_CACHED_MS);
  }, 60_000);
});
