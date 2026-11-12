import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { shiftYears } from '../../src/domain/age/age.js';
import { nameKey } from '../../src/domain/name-matching/name-key.js';
import { normalizeName } from '../../src/domain/name-matching/normalize.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { bearer, sessionWithRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';

const app = createApp();
const today = new Date().toISOString().slice(0, 10);
const bornYearsAgo = (years: number): Date => new Date(`${shiftYears(today, years)}T00:00:00.000Z`);

function seedPlayer(fullName: string, data: Partial<Prisma.PlayerUncheckedCreateInput> = {}) {
  return prisma.player.create({
    data: { fullName, normalizedName: normalizeName(fullName), nameKey: nameKey(fullName), status: 'ACTIVE', ...data },
  });
}

async function seedPlayers() {
  await seedPlayer('Ana López', { federation: 'MEX', sex: 'F', clubCode: 'MOCHIS', ratingElo: 1500, birthDate: bornYearsAgo(10), fideId: '1001' });
  await seedPlayer('Beto Ruiz', { federation: 'MEX', sex: 'M', clubCode: 'CULIACAN', status: 'PENDING', ratingElo: 1800, birthDate: bornYearsAgo(12) });
  await seedPlayer('Carla Soto', { federation: 'USA', sex: 'F', clubCode: 'MOCHIS', ratingElo: 2000, birthDate: bornYearsAgo(13) });
  await seedPlayer('Dani Paz', { federation: 'ESP', sex: 'M', clubCode: 'MAZATLAN', status: 'INACTIVE' });
  await seedPlayer('Eva Luna', { federation: 'MEX', sex: 'F', birthDate: bornYearsAgo(9) });
}

describe('jugadores: búsqueda avanzada (RF10, RF12)', () => {
  beforeEach(async () => {
    await resetDb();
    await seedPlayers();
  });
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  const search = async (query: string) => {
    const { token } = await sessionWithRole(app);
    const res = await request(app).get(`/api/v1/jugadores?${query}`).set(...bearer(token)).expect(200);
    return (res.body.data as { fullName: string }[]).map((p) => p.fullName).sort();
  };

  it('sin filtros excluye a los inactivos', async () => {
    expect(await search('')).toEqual(['Ana López', 'Beto Ruiz', 'Carla Soto', 'Eva Luna']);
  });

  it('status admite varios valores e incluye inactivos si se piden', async () => {
    expect(await search('status=ACTIVE,PENDING')).toEqual(['Ana López', 'Beto Ruiz', 'Carla Soto', 'Eva Luna']);
    expect(await search('status=PENDING')).toEqual(['Beto Ruiz']);
    expect(await search('status=INACTIVE')).toEqual(['Dani Paz']);
    expect(await search('status=INACTIVE,PENDING')).toEqual(['Beto Ruiz', 'Dani Paz']);
  });

  it('club y federation admiten varios valores', async () => {
    expect(await search('club=mochis,culiacan')).toEqual(['Ana López', 'Beto Ruiz', 'Carla Soto']);
    expect(await search('federation=mex,usa')).toEqual(['Ana López', 'Beto Ruiz', 'Carla Soto', 'Eva Luna']);
    expect(await search('federation=usa')).toEqual(['Carla Soto']);
  });

  it('fideId y q coinciden por FIDE exacto', async () => {
    expect(await search('fideId=1001')).toEqual(['Ana López']);
    expect(await search('q=1001')).toEqual(['Ana López']);
    expect(await search('fideId=100')).toEqual([]);
  });

  it('q busca por contenido sin acentos ni mayúsculas', async () => {
    expect(await search('q=LOPEZ')).toEqual(['Ana López']);
    expect(await search('q=ana lo')).toEqual(['Ana López']);
    expect(await search('q=zzz')).toEqual([]);
  });

  it('q con solo signos no devuelve todo el catálogo', async () => {
    expect(await search('q=%27%27')).toEqual([]);
  });

  it('sex filtra por M o F', async () => {
    expect(await search('sex=M')).toEqual(['Beto Ruiz']);
    expect(await search('sex=F')).toEqual(['Ana López', 'Carla Soto', 'Eva Luna']);
  });

  it('edadMin y edadMax usan años cumplidos hoy y excluyen a quien no tiene fecha de nacimiento', async () => {
    expect(await search('edadMin=10&edadMax=12')).toEqual(['Ana López', 'Beto Ruiz']);
    expect(await search('edadMin=13')).toEqual(['Carla Soto']);
    expect(await search('edadMax=9')).toEqual(['Eva Luna']);
    expect(await search('edadMin=0&status=ACTIVE,PENDING,INACTIVE')).toEqual(['Ana López', 'Beto Ruiz', 'Carla Soto', 'Eva Luna']);
  });

  it('combina filtros', async () => {
    expect(await search('sex=F&edadMin=10&status=ACTIVE')).toEqual(['Ana López', 'Carla Soto']);
    expect(await search('federation=MEX&ratingMin=1600&club=culiacan')).toEqual(['Beto Ruiz']);
  });

  it('ordena por fecha de nacimiento con desempate estable', async () => {
    const { token } = await sessionWithRole(app);
    const res = await request(app)
      .get('/api/v1/jugadores?sortBy=birthDate&order=asc')
      .set(...bearer(token))
      .expect(200);
    const names = (res.body.data as { fullName: string }[]).map((p) => p.fullName);
    // Del más viejo al más joven; sin fecha de nacimiento no hay activos sin ella salvo los de la lista
    expect(names.slice(0, 4)).toEqual(['Carla Soto', 'Beto Ruiz', 'Ana López', 'Eva Luna']);
  });

  it.each([
    'edadMin=abc',
    'edadMin=-1',
    'edadMax=121',
    'edadMin=1.5',
    'edadMin=13&edadMax=10',
    'sex=X',
    'status=ACTIVE,NOPE',
    'status=',
    'federation=MEX,MEXICO',
    'fideId=',
    'club=a,b,c,d,e,f,g,h,i,j,k',
  ])('422: %s', async (query) => {
    const { token } = await sessionWithRole(app);
    const res = await request(app).get(`/api/v1/jugadores?${query}`).set(...bearer(token)).expect(422);
    expect(res.body.code).toBe('UNPROCESSABLE_ENTITY');
  });
});
