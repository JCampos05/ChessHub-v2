import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { categoryRepository } from '../../src/modules/categories/category.repository.js';
import { playerRepository } from '../../src/modules/players/player.repository.js';
import { tournamentRepository } from '../../src/modules/tournaments/tournament.repository.js';
import { bearer, sessionWithRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';

const app = createApp();
const MISSING = '0190aaaa-0000-7000-8000-000000000099';

const tournament = { name: 'Torneo de Invierno', startDate: '2030-01-10', endDate: '2030-01-11', city: 'Los Mochis' };

describe('caché de lecturas (RF13)', () => {
  let admin: string;
  let reader: string;

  beforeEach(async () => {
    await resetDb();
    admin = (await sessionWithRole(app, 'FEDERATION_ADMIN')).token;
    reader = (await sessionWithRole(app)).token;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  const get = (url: string, token = reader) => request(app).get(url).set(...bearer(token));
  const names = (res: { body: { data: { name: string }[] } }) => res.body.data.map((item) => item.name);

  describe('torneos', () => {
    it('la segunda lectura igual no consulta la base', async () => {
      const spy = vi.spyOn(tournamentRepository, 'list');
      await request(app).post('/api/v1/torneos').set(...bearer(admin)).send(tournament).expect(201);

      const first = await get('/api/v1/torneos?limit=5').expect(200);
      const second = await get('/api/v1/torneos?limit=5').expect(200);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(second.body).toEqual(first.body);
    });

    it('el orden de los parámetros no cambia el resultado ni vuelve a consultar', async () => {
      const spy = vi.spyOn(tournamentRepository, 'list');
      await get('/api/v1/torneos?estado=1&ciudad=Los Mochis').expect(200);
      await get('/api/v1/torneos?ciudad=Los Mochis&estado=1').expect(200);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('consultas distintas no se mezclan', async () => {
      await request(app).post('/api/v1/torneos').set(...bearer(admin)).send(tournament).expect(201);
      const all = await get('/api/v1/torneos').expect(200);
      const other = await get('/api/v1/torneos?ciudad=Culiacán').expect(200);
      expect(all.body.meta.total).toBe(1);
      expect(other.body.meta.total).toBe(0);
    });

    it('crear invalida el listado', async () => {
      expect((await get('/api/v1/torneos').expect(200)).body.meta.total).toBe(0);
      await request(app).post('/api/v1/torneos').set(...bearer(admin)).send(tournament).expect(201);
      expect((await get('/api/v1/torneos').expect(200)).body.meta.total).toBe(1);
    });

    it('editar invalida el detalle y el listado', async () => {
      const created = await request(app).post('/api/v1/torneos').set(...bearer(admin)).send(tournament).expect(201);
      const url = `/api/v1/torneos/${created.body.id}`;

      expect((await get(url).expect(200)).body.city).toBe('Los Mochis');
      expect(names(await get('/api/v1/torneos').expect(200))).toEqual(['Torneo de Invierno']);

      await request(app).patch(url).set(...bearer(admin)).send({ name: 'Torneo Renombrado', city: 'Culiacán' }).expect(200);

      expect((await get(url).expect(200)).body.city).toBe('Culiacán');
      expect(names(await get('/api/v1/torneos').expect(200))).toEqual(['Torneo Renombrado']);
    });

    it('dar de baja saca el torneo del listado cacheado', async () => {
      const created = await request(app).post('/api/v1/torneos').set(...bearer(admin)).send(tournament).expect(201);
      expect((await get('/api/v1/torneos').expect(200)).body.meta.total).toBe(1);

      await request(app).delete(`/api/v1/torneos/${created.body.id}`).set(...bearer(admin)).expect(200);

      expect((await get('/api/v1/torneos').expect(200)).body.meta.total).toBe(0);
    });

    it('vincular y desvincular categorías invalida el filtro por categoría', async () => {
      const created = await request(app).post('/api/v1/torneos').set(...bearer(admin)).send(tournament).expect(201);
      const category = await request(app).post('/api/v1/categorias').set(...bearer(admin)).send({ name: 'Sub-12' }).expect(201);
      const filter = `/api/v1/torneos?categoryId=${category.body.id}`;
      const link = `/api/v1/torneos/${created.body.id}/categorias/${category.body.id}`;

      expect((await get(filter).expect(200)).body.meta.total).toBe(0);
      await request(app).put(link).set(...bearer(admin)).expect(200);
      expect((await get(filter).expect(200)).body.meta.total).toBe(1);
      await request(app).delete(link).set(...bearer(admin)).expect(200);
      expect((await get(filter).expect(200)).body.meta.total).toBe(0);
    });

    it('un torneo inexistente no se cachea', async () => {
      const spy = vi.spyOn(tournamentRepository, 'findById');
      await get(`/api/v1/torneos/${MISSING}`).expect(404);
      await get(`/api/v1/torneos/${MISSING}`).expect(404);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('una lectura cacheada no se salta los permisos', async () => {
      await get('/api/v1/torneos').expect(200);
      await request(app).get('/api/v1/torneos').expect(401);
    });
  });

  describe('jugadores', () => {
    const newPlayer = { fullName: 'Ana López', email: 'ana@example.com', phone: '6671112233', birthDate: '2015-04-02' };
    const createPlayer = (body: object = newPlayer) =>
      request(app).post('/api/v1/jugadores').set(...bearer(admin)).send(body).expect(201);
    const fullNames = (res: { body: { data: { fullName: string }[] } }) => res.body.data.map((p) => p.fullName);

    it('la vista pública se sirve desde la caché en la segunda lectura', async () => {
      const spy = vi.spyOn(playerRepository, 'list');
      await createPlayer();
      await get('/api/v1/jugadores').expect(200);
      await get('/api/v1/jugadores').expect(200);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('la vista privada no se cachea porque contiene datos de contacto', async () => {
      const spy = vi.spyOn(playerRepository, 'list');
      await createPlayer();
      await get('/api/v1/jugadores', admin).expect(200);
      await get('/api/v1/jugadores', admin).expect(200);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('la vista pública nunca trae contacto aunque la privada se haya consultado antes (RN-07)', async () => {
      await createPlayer();

      const asAdmin = await get('/api/v1/jugadores', admin).expect(200);
      expect(asAdmin.body.data[0].email).toBe('ana@example.com');

      const asReader = await get('/api/v1/jugadores').expect(200);
      expect(asReader.body.data[0]).toMatchObject({ fullName: 'Ana López' });
      for (const field of ['email', 'phone', 'birthDate']) expect(asReader.body.data[0][field]).toBeUndefined();
    });

    it('la vista privada trae contacto aunque la pública se haya cacheado antes', async () => {
      await createPlayer();
      await get('/api/v1/jugadores').expect(200);

      const asAdmin = await get('/api/v1/jugadores', admin).expect(200);
      expect(asAdmin.body.data[0]).toMatchObject({ email: 'ana@example.com', phone: '6671112233' });
    });

    it('crear, editar y dar de baja invalidan el listado público', async () => {
      expect((await get('/api/v1/jugadores').expect(200)).body.meta.total).toBe(0);

      const created = await createPlayer();
      expect(fullNames(await get('/api/v1/jugadores').expect(200))).toEqual(['Ana López']);

      const url = `/api/v1/jugadores/${created.body.id}`;
      await request(app).patch(url).set(...bearer(admin)).send({ fullName: 'Ana María López' }).expect(200);
      expect(fullNames(await get('/api/v1/jugadores').expect(200))).toEqual(['Ana María López']);

      await request(app).delete(url).set(...bearer(admin)).expect(200);
      expect((await get('/api/v1/jugadores').expect(200)).body.meta.total).toBe(0);
    });

    it('consultas con filtros distintos no se mezclan', async () => {
      await createPlayer();
      expect((await get('/api/v1/jugadores').expect(200)).body.meta.total).toBe(1);
      expect((await get('/api/v1/jugadores?q=zzz').expect(200)).body.meta.total).toBe(0);
    });
  });

  describe('categorías', () => {
    it('la segunda lectura igual no consulta la base', async () => {
      const spy = vi.spyOn(categoryRepository, 'list');
      await get('/api/v1/categorias').expect(200);
      await get('/api/v1/categorias').expect(200);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('crear, editar y dar de baja invalidan listado y detalle', async () => {
      expect((await get('/api/v1/categorias').expect(200)).body.meta.total).toBe(0);

      const created = await request(app).post('/api/v1/categorias').set(...bearer(admin)).send({ name: 'Libre' }).expect(201);
      const url = `/api/v1/categorias/${created.body.id}`;
      expect(names(await get('/api/v1/categorias').expect(200))).toEqual(['Libre']);
      expect((await get(url).expect(200)).body.name).toBe('Libre');

      await request(app).patch(url).set(...bearer(admin)).send({ name: 'Abierta' }).expect(200);
      expect(names(await get('/api/v1/categorias').expect(200))).toEqual(['Abierta']);
      expect((await get(url).expect(200)).body.name).toBe('Abierta');

      await request(app).delete(url).set(...bearer(admin)).expect(200);
      expect((await get('/api/v1/categorias').expect(200)).body.meta.total).toBe(0);
      expect((await get(url).expect(200)).body.isActive).toBe(false);
    });
  });
});

describe('categorías: filtro por edad (RF12)', () => {
  beforeEach(async () => {
    await resetDb();
    const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
    for (const body of [
      { name: 'Sub-10', maxAge: 10 },
      { name: 'Sub-14', minAge: 11, maxAge: 14 },
      { name: 'Mayores', minAge: 15 },
      { name: 'Libre' },
    ]) {
      await request(app).post('/api/v1/categorias').set(...bearer(token)).send(body).expect(201);
    }
  });
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  const byAge = async (edad: number | string) => {
    const { token } = await sessionWithRole(app);
    const res = await request(app).get(`/api/v1/categorias?edad=${edad}`).set(...bearer(token)).expect(200);
    return (res.body.data as { name: string }[]).map((c) => c.name).sort();
  };

  it('devuelve las categorías que admiten esa edad, incluidas las abiertas por un extremo', async () => {
    expect(await byAge(8)).toEqual(['Libre', 'Sub-10']);
    expect(await byAge(12)).toEqual(['Libre', 'Sub-14']);
    expect(await byAge(40)).toEqual(['Libre', 'Mayores']);
  });

  it('los límites son inclusivos', async () => {
    expect(await byAge(10)).toEqual(['Libre', 'Sub-10']);
    expect(await byAge(11)).toEqual(['Libre', 'Sub-14']);
    expect(await byAge(14)).toEqual(['Libre', 'Sub-14']);
    expect(await byAge(15)).toEqual(['Libre', 'Mayores']);
  });

  it.each(['abc', '-1', '121', '10.5'])('422: edad=%s', async (edad) => {
    const { token } = await sessionWithRole(app);
    const res = await request(app).get(`/api/v1/categorias?edad=${edad}`).set(...bearer(token)).expect(422);
    expect(res.body.code).toBe('UNPROCESSABLE_ENTITY');
  });
});
