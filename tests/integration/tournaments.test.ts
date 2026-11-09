import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { bearer, grantScopedRole, sessionWithRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';

const app = createApp();
const MISSING = '0190aaaa-0000-7000-8000-000000000099';

const valid = {
  name: 'Torneo Estatal de Primavera',
  startDate: '2026-12-05',
  endDate: '2026-12-06',
  venue: 'Casa de la Cultura',
  city: 'Los Mochis',
  roundsPlanned: 7,
  maxPlayers: 80,
  timeControl: '25+5',
};

function createTournament(token: string, body: object = valid) {
  return request(app)
    .post('/api/v1/torneos')
    .set(...bearer(token))
    .send(body);
}

describe('torneos (RF06, RF09, RNF08)', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('autenticación y permisos', () => {
    it('401 sin token', async () => {
      await request(app).get('/api/v1/torneos').expect(401);
      await request(app).post('/api/v1/torneos').send({}).expect(401);
      await request(app).get('/api/v1/torneos/1').expect(401);
      await request(app).patch('/api/v1/torneos/1').send({}).expect(401);
      await request(app).delete('/api/v1/torneos/1').expect(401);
    });

    it('un usuario sin rol lee pero no crea (403)', async () => {
      const { token } = await sessionWithRole(app);
      await request(app).get('/api/v1/torneos').set(...bearer(token)).expect(200);
      const res = await createTournament(token).expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('un árbitro de mesa no crea torneos (403)', async () => {
      const { token } = await sessionWithRole(app, 'ARBITER');
      await createTournament(token).expect(403);
    });

    it('id malformado responde 404', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await request(app).get('/api/v1/torneos/1').set(...bearer(token)).expect(404);
      await request(app).patch('/api/v1/torneos/1').set(...bearer(token)).send({ name: 'xxx' }).expect(404);
      await request(app).delete('/api/v1/torneos/1').set(...bearer(token)).expect(404);
    });

    it('el creador con rol estatal edita su torneo pero no el de otro (RN-08)', async () => {
      const owner = await sessionWithRole(app);
      await grantScopedRole(owner.user.id, 'STATE_ADMIN', 'STATE', MISSING);
      const other = await sessionWithRole(app);
      await grantScopedRole(other.user.id, 'STATE_ADMIN', 'STATE', MISSING);

      const created = await createTournament(owner.token).expect(201);
      const url = `/api/v1/torneos/${created.body.id}`;

      await request(app).patch(url).set(...bearer(owner.token)).send({ city: 'Culiacán' }).expect(200);
      const denied = await request(app).patch(url).set(...bearer(other.token)).send({ city: 'Otra' }).expect(403);
      expect(denied.body.code).toBe('OUT_OF_SCOPE');
      await request(app).delete(url).set(...bearer(other.token)).expect(403);
    });

    it('un organizador con ámbito de ese torneo lo edita; en otro torneo no', async () => {
      const admin = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const first = await createTournament(admin.token).expect(201);
      const second = await createTournament(admin.token, { ...valid, name: 'Otro torneo' }).expect(201);

      const organizer = await sessionWithRole(app);
      await grantScopedRole(organizer.user.id, 'ORGANIZER', 'TOURNAMENT', first.body.id);

      await request(app)
        .patch(`/api/v1/torneos/${first.body.id}`)
        .set(...bearer(organizer.token))
        .send({ venue: 'Nueva sede' })
        .expect(200);
      await request(app)
        .patch(`/api/v1/torneos/${second.body.id}`)
        .set(...bearer(organizer.token))
        .send({ venue: 'Nueva sede' })
        .expect(403);
    });

    it('404 antes que 403 cuando el torneo no existe', async () => {
      const { token } = await sessionWithRole(app);
      await request(app).patch(`/api/v1/torneos/${MISSING}`).set(...bearer(token)).send({ name: 'xxx' }).expect(404);
    });
  });

  describe('POST /torneos', () => {
    it('201: crea el torneo en convocatoria', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await createTournament(token).expect(201);
      expect(res.body).toMatchObject({
        name: valid.name,
        startDate: '2026-12-05',
        endDate: '2026-12-06',
        roundsPlanned: 7,
        status: 'REGISTRATION_OPEN',
        isActive: true,
      });
    });

    it('acepta los alias en español', async () => {
      const { token } = await sessionWithRole(app, 'SUPER_ADMIN');
      const res = await createTournament(token, {
        nombre: 'Copa Mochis',
        fechaInicio: '2027-01-10',
        fechaFin: '2027-01-10',
        sede: 'Club',
        ciudad: 'Los Mochis',
        rondas: 5,
        cupo: 40,
      }).expect(201);
      expect(res.body).toMatchObject({ name: 'Copa Mochis', venue: 'Club', city: 'Los Mochis', roundsPlanned: 5 });
    });

    it('ignora el estado enviado: siempre nace en convocatoria', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await createTournament(token, { ...valid, status: 'FINISHED' }).expect(201);
      expect(res.body.status).toBe('REGISTRATION_OPEN');
    });

    it.each([
      ['cuerpo vacío', {}],
      ['sin fechas', { name: 'Torneo sin fechas' }],
      ['fecha fin anterior al inicio', { ...valid, startDate: '2026-12-06', endDate: '2026-12-05' }],
      ['fecha inexistente', { ...valid, startDate: '2026-02-31' }],
      ['formato de fecha incorrecto', { ...valid, startDate: '05/12/2026' }],
      ['nombre muy corto', { ...valid, name: 'ab' }],
      ['rondas en cero', { ...valid, roundsPlanned: 0 }],
      ['cupo de un jugador', { ...valid, maxPlayers: 1 }],
      ['rondas no numéricas', { ...valid, roundsPlanned: 'siete' }],
    ])('400: %s', async (_caso, body) => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await createTournament(token, body).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors?.length).toBeGreaterThan(0);
    });
  });

  describe('GET /torneos', () => {
    it('200: lista vacía con meta', async () => {
      const { token } = await sessionWithRole(app);
      const res = await request(app).get('/api/v1/torneos').set(...bearer(token)).expect(200);
      expect(res.body).toEqual({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    });

    it('pagina, ordena y filtra por texto, estado y fechas', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await createTournament(token, { ...valid, name: 'Abierto de Invierno', startDate: '2026-12-01', endDate: '2026-12-02' });
      await createTournament(token, { ...valid, name: 'Copa Primavera', startDate: '2027-03-01', endDate: '2027-03-02', city: 'Culiacán' });
      const third = await createTournament(token, { ...valid, name: 'Magistral', startDate: '2027-05-01', endDate: '2027-05-03' });
      await prisma.tournament.update({ where: { id: third.body.id }, data: { status: 'IN_PROGRESS' } });

      const asc = await request(app)
        .get('/api/v1/torneos?sortBy=startDate&order=ASC&limit=2&page=1')
        .set(...bearer(token))
        .expect(200);
      expect(asc.body.data.map((t: { name: string }) => t.name)).toEqual(['Abierto de Invierno', 'Copa Primavera']);
      expect(asc.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });

      const byText = await request(app).get('/api/v1/torneos?q=culiac').set(...bearer(token)).expect(200);
      expect(byText.body.meta.total).toBe(1);

      for (const estado of ['en_juego', 'IN_PROGRESS', '3']) {
        const byStatus = await request(app).get(`/api/v1/torneos?estado=${estado}`).set(...bearer(token)).expect(200);
        expect(byStatus.body.data.map((t: { name: string }) => t.name)).toEqual(['Magistral']);
      }

      const byDates = await request(app)
        .get('/api/v1/torneos?desde=2027-01-01&hasta=2027-04-01')
        .set(...bearer(token))
        .expect(200);
      expect(byDates.body.data.map((t: { name: string }) => t.name)).toEqual(['Copa Primavera']);
    });

    it.each(['page=0', 'limit=101', 'sortBy=status', 'order=up', 'estado=abierto', 'desde=ayer', 'includeInactive=2'])(
      '422: parámetro inválido %s',
      async (query) => {
        const { token } = await sessionWithRole(app);
        const res = await request(app).get(`/api/v1/torneos?${query}`).set(...bearer(token)).expect(422);
        expect(res.body.code).toBe('UNPROCESSABLE_ENTITY');
      },
    );
  });

  describe('GET, PATCH y DELETE /torneos/:id', () => {
    it('404 cuando no existe', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await request(app).get(`/api/v1/torneos/${MISSING}`).set(...bearer(token)).expect(404);
      await request(app).delete(`/api/v1/torneos/${MISSING}`).set(...bearer(token)).expect(404);
    });

    it('actualiza parcialmente y valida las fechas con los valores resultantes', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const created = await createTournament(token).expect(201);
      const url = `/api/v1/torneos/${created.body.id}`;

      const ok = await request(app).patch(url).set(...bearer(token)).send({ venue: 'Gimnasio', endDate: '2026-12-08' }).expect(200);
      expect(ok.body).toMatchObject({ venue: 'Gimnasio', endDate: '2026-12-08', name: valid.name });

      const bad = await request(app).patch(url).set(...bearer(token)).send({ startDate: '2026-12-20' }).expect(400);
      expect(bad.body.code).toBe('INVALID_DATE_RANGE');
      await request(app).patch(url).set(...bearer(token)).send({}).expect(400);
    });

    it('el estado no se modifica por PATCH', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const created = await createTournament(token).expect(201);
      const res = await request(app)
        .patch(`/api/v1/torneos/${created.body.id}`)
        .set(...bearer(token))
        .send({ status: 'FINISHED', city: 'Guasave' })
        .expect(200);
      expect(res.body.status).toBe('REGISTRATION_OPEN');
      expect(res.body.city).toBe('Guasave');
    });

    it('409: un torneo finalizado no admite cambios', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const created = await createTournament(token).expect(201);
      await prisma.tournament.update({ where: { id: created.body.id }, data: { status: 'FINISHED' } });
      const res = await request(app)
        .patch(`/api/v1/torneos/${created.body.id}`)
        .set(...bearer(token))
        .send({ city: 'Otra' })
        .expect(409);
      expect(res.body.code).toBe('TOURNAMENT_NOT_EDITABLE');
    });

    it('baja lógica: 200, idempotente, conserva el registro y sale del listado', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const created = await createTournament(token).expect(201);
      const url = `/api/v1/torneos/${created.body.id}`;

      const first = await request(app).delete(url).set(...bearer(token)).expect(200);
      expect(first.body.isActive).toBe(false);
      await request(app).delete(url).set(...bearer(token)).expect(200);

      expect(await prisma.tournament.count({ where: { id: created.body.id } })).toBe(1);
      const list = await request(app).get('/api/v1/torneos').set(...bearer(token)).expect(200);
      expect(list.body.data).toHaveLength(0);
      const all = await request(app).get('/api/v1/torneos?includeInactive=true').set(...bearer(token)).expect(200);
      expect(all.body.data).toHaveLength(1);
    });

    it('409: un torneo en juego no se da de baja', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const created = await createTournament(token).expect(201);
      await prisma.tournament.update({ where: { id: created.body.id }, data: { status: 'ROUND_IN_PROGRESS' } });
      await request(app).delete(`/api/v1/torneos/${created.body.id}`).set(...bearer(token)).expect(409);
    });
  });

  describe('categorías del torneo', () => {
    it('vincula, lista y desvincula; vincular dos veces es idempotente', async () => {
      const { token } = await sessionWithRole(app, 'SUPER_ADMIN');
      const tournament = await createTournament(token).expect(201);
      const category = await request(app)
        .post('/api/v1/categorias')
        .set(...bearer(token))
        .send({ name: 'Absoluta' })
        .expect(201);
      const base = `/api/v1/torneos/${tournament.body.id}/categorias`;

      await request(app).put(`${base}/${category.body.id}`).set(...bearer(token)).expect(200);
      await request(app).put(`${base}/${category.body.id}`).set(...bearer(token)).expect(200);

      const list = await request(app).get(base).set(...bearer(token)).expect(200);
      expect(list.body.data.map((c: { name: string }) => c.name)).toEqual(['Absoluta']);

      await request(app).delete(`${base}/${category.body.id}`).set(...bearer(token)).expect(200);
      const empty = await request(app).get(base).set(...bearer(token)).expect(200);
      expect(empty.body.data).toEqual([]);
    });

    it('400 REFERENCE_NOT_FOUND con una categoría inexistente o inactiva', async () => {
      const { token } = await sessionWithRole(app, 'SUPER_ADMIN');
      const tournament = await createTournament(token).expect(201);
      const base = `/api/v1/torneos/${tournament.body.id}/categorias`;

      const missing = await request(app).put(`${base}/${MISSING}`).set(...bearer(token)).expect(400);
      expect(missing.body.code).toBe('REFERENCE_NOT_FOUND');

      const category = await request(app).post('/api/v1/categorias').set(...bearer(token)).send({ name: 'Vieja' }).expect(201);
      await request(app).delete(`/api/v1/categorias/${category.body.id}`).set(...bearer(token)).expect(200);
      await request(app).put(`${base}/${category.body.id}`).set(...bearer(token)).expect(400);
    });

    it('un usuario sin permiso no vincula categorías (403)', async () => {
      const admin = await sessionWithRole(app, 'SUPER_ADMIN');
      const tournament = await createTournament(admin.token).expect(201);
      const category = await request(app).post('/api/v1/categorias').set(...bearer(admin.token)).send({ name: 'Libre' }).expect(201);
      const user = await sessionWithRole(app);
      await request(app)
        .put(`/api/v1/torneos/${tournament.body.id}/categorias/${category.body.id}`)
        .set(...bearer(user.token))
        .expect(403);
    });
  });

  it('alias en inglés: /tournaments responde igual que /torneos', async () => {
    const { token } = await sessionWithRole(app);
    await request(app).get('/api/v1/tournaments').set(...bearer(token)).expect(200);
  });
});
