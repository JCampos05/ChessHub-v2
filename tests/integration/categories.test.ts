import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { bearer, sessionWithRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';

const app = createApp();

describe('categorias (RF07, RNF08)', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('autenticación y permisos', () => {
    it('401 sin token en todas las operaciones', async () => {
      await request(app).get('/api/v1/categorias').expect(401);
      await request(app).post('/api/v1/categorias').send({}).expect(401);
      await request(app).get('/api/v1/categorias/1').expect(401);
      await request(app).patch('/api/v1/categorias/1').send({}).expect(401);
      await request(app).delete('/api/v1/categorias/1').expect(401);
    });

    it('un usuario sin rol puede leer pero no escribir (403)', async () => {
      const { token } = await sessionWithRole(app);
      await request(app).get('/api/v1/categorias').set(...bearer(token)).expect(200);
      const res = await request(app)
        .post('/api/v1/categorias')
        .set(...bearer(token))
        .send({ name: 'Sub-12' })
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('un árbitro de mesa no administra el catálogo (403)', async () => {
      const { token } = await sessionWithRole(app, 'ARBITER');
      await request(app).post('/api/v1/categorias').set(...bearer(token)).send({ name: 'Sub-12' }).expect(403);
    });

    it('id malformado responde 404', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await request(app).get('/api/v1/categorias/1').set(...bearer(token)).expect(404);
      await request(app).patch('/api/v1/categorias/1').set(...bearer(token)).send({ name: 'x' }).expect(404);
      await request(app).delete('/api/v1/categorias/1').set(...bearer(token)).expect(404);
    });
  });

  describe('POST /categorias', () => {
    it('201: crea la categoría con valores por omisión', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app)
        .post('/api/v1/categorias')
        .set(...bearer(token))
        .send({ name: 'Sub-12', minAge: 0, maxAge: 12, defaultCost: 150.5 })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Sub-12',
        minAge: 0,
        maxAge: 12,
        defaultCost: 150.5,
        usesElo: false,
        isActive: true,
      });
    });

    it('acepta los alias en español', async () => {
      const { token } = await sessionWithRole(app, 'SUPER_ADMIN');
      const res = await request(app)
        .post('/api/v1/categorias')
        .set(...bearer(token))
        .send({ nombre: 'Libre', costo: 200, usaElo: true })
        .expect(201);
      expect(res.body).toMatchObject({ name: 'Libre', defaultCost: 200, usesElo: true });
    });

    it.each([
      ['cuerpo vacío', {}],
      ['nombre muy corto', { name: 'a' }],
      ['edad mínima mayor que la máxima', { name: 'Raro', minAge: 20, maxAge: 10 }],
      ['costo negativo', { name: 'Raro', defaultCost: -1 }],
      ['costo con tres decimales', { name: 'Raro', defaultCost: 1.234 }],
      ['edad no numérica', { name: 'Raro', minAge: 'diez' }],
    ])('400: %s', async (_caso, body) => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app).post('/api/v1/categorias').set(...bearer(token)).send(body).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors?.length).toBeGreaterThan(0);
    });

    it('409: nombre repetido sin distinguir mayúsculas', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await request(app).post('/api/v1/categorias').set(...bearer(token)).send({ name: 'Sub-12' }).expect(201);
      const res = await request(app)
        .post('/api/v1/categorias')
        .set(...bearer(token))
        .send({ name: 'SUB-12' })
        .expect(409);
      expect(res.body.code).toBe('CATEGORY_DUPLICATE');
    });

    it('creaciones simultáneas con el mismo nombre: una sola gana (RNF-02)', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          request(app).post('/api/v1/categorias').set(...bearer(token)).send({ name: 'Concurrente' }),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    });
  });

  describe('GET /categorias', () => {
    it('200: lista vacía con meta', async () => {
      const { token } = await sessionWithRole(app);
      const res = await request(app).get('/api/v1/categorias').set(...bearer(token)).expect(200);
      expect(res.body).toEqual({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    });

    it('pagina, ordena y filtra', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      for (const [name, usesElo] of [
        ['Absoluta', true],
        ['Sub-10', false],
        ['Sub-14', false],
      ] as const) {
        await request(app).post('/api/v1/categorias').set(...bearer(token)).send({ name, usesElo }).expect(201);
      }

      const page = await request(app)
        .get('/api/v1/categorias?page=1&limit=2&sortBy=name&order=ASC')
        .set(...bearer(token))
        .expect(200);
      expect(page.body.data.map((c: { name: string }) => c.name)).toEqual(['Absoluta', 'Sub-10']);
      expect(page.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });

      const elo = await request(app).get('/api/v1/categorias?usaElo=true').set(...bearer(token)).expect(200);
      expect(elo.body.data).toHaveLength(1);

      const search = await request(app).get('/api/v1/categorias?q=sub').set(...bearer(token)).expect(200);
      expect(search.body.meta.total).toBe(2);
    });

    it.each(['page=0', 'limit=500', 'sortBy=password', 'order=sideways', 'usaElo=quizas'])(
      '422: parámetro inválido %s',
      async (query) => {
        const { token } = await sessionWithRole(app);
        const res = await request(app).get(`/api/v1/categorias?${query}`).set(...bearer(token)).expect(422);
        expect(res.body.code).toBe('UNPROCESSABLE_ENTITY');
      },
    );
  });

  describe('GET, PATCH y DELETE /categorias/:id', () => {
    it('404: no existe', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const missing = '0190aaaa-0000-7000-8000-000000000099';
      await request(app).get(`/api/v1/categorias/${missing}`).set(...bearer(token)).expect(404);
      await request(app).patch(`/api/v1/categorias/${missing}`).set(...bearer(token)).send({ name: 'Nueva' }).expect(404);
      await request(app).delete(`/api/v1/categorias/${missing}`).set(...bearer(token)).expect(404);
    });

    it('actualiza parcialmente y valida el rango con los valores resultantes', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const created = await request(app)
        .post('/api/v1/categorias')
        .set(...bearer(token))
        .send({ name: 'Sub-16', minAge: 10, maxAge: 16 })
        .expect(201);
      const url = `/api/v1/categorias/${created.body.id}`;

      const ok = await request(app).patch(url).set(...bearer(token)).send({ defaultCost: 99.9 }).expect(200);
      expect(ok.body).toMatchObject({ name: 'Sub-16', defaultCost: 99.9, minAge: 10, maxAge: 16 });

      await request(app).patch(url).set(...bearer(token)).send({ minAge: 18 }).expect(400);
      await request(app).patch(url).set(...bearer(token)).send({}).expect(400);
    });

    it('409: renombrar a un nombre existente', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await request(app).post('/api/v1/categorias').set(...bearer(token)).send({ name: 'Alfa' }).expect(201);
      const beta = await request(app).post('/api/v1/categorias').set(...bearer(token)).send({ name: 'Beta' }).expect(201);
      await request(app)
        .patch(`/api/v1/categorias/${beta.body.id}`)
        .set(...bearer(token))
        .send({ name: 'alfa' })
        .expect(409);
    });

    it('baja lógica: 200, idempotente, conserva el registro y sale del listado', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const created = await request(app).post('/api/v1/categorias').set(...bearer(token)).send({ name: 'Veteranos' }).expect(201);
      const url = `/api/v1/categorias/${created.body.id}`;

      const first = await request(app).delete(url).set(...bearer(token)).expect(200);
      expect(first.body.isActive).toBe(false);
      await request(app).delete(url).set(...bearer(token)).expect(200);

      expect(await prisma.category.count({ where: { id: created.body.id } })).toBe(1);
      const list = await request(app).get('/api/v1/categorias').set(...bearer(token)).expect(200);
      expect(list.body.data).toHaveLength(0);
      const all = await request(app).get('/api/v1/categorias?includeInactive=true').set(...bearer(token)).expect(200);
      expect(all.body.data).toHaveLength(1);
      await request(app).get(url).set(...bearer(token)).expect(200);
    });
  });

  describe('alias en inglés', () => {
    it('/categories responde igual que /categorias', async () => {
      const { token } = await sessionWithRole(app);
      await request(app).get('/api/v1/categories').set(...bearer(token)).expect(200);
    });
  });
});
