import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { bearer, sessionWithRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';

const app = createApp();
const MISSING = '0190aaaa-0000-7000-8000-000000000099';

function createPlayer(token: string, body: object) {
  return request(app)
    .post('/api/v1/jugadores')
    .set(...bearer(token))
    .send(body);
}

describe('jugadores: listado, edición y baja (RF06, RNF08)', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('autenticación', () => {
    it('401 sin token', async () => {
      await request(app).get('/api/v1/jugadores').expect(401);
      await request(app).patch('/api/v1/jugadores/1').send({}).expect(401);
      await request(app).delete('/api/v1/jugadores/1').expect(401);
    });

    it('id malformado responde 404', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await request(app).patch('/api/v1/jugadores/1').set(...bearer(token)).send({ clubCode: 'X' }).expect(404);
      await request(app).delete('/api/v1/jugadores/1').set(...bearer(token)).expect(404);
    });
  });

  describe('GET /jugadores', () => {
    it('200: lista vacía con meta', async () => {
      const { token } = await sessionWithRole(app);
      const res = await request(app).get('/api/v1/jugadores').set(...bearer(token)).expect(200);
      expect(res.body).toEqual({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    });

    it('filtra por club, rating y texto; los datos de contacto no salen en la lista', async () => {
      const admin = await sessionWithRole(app, 'SUPER_ADMIN');
      const officer = await sessionWithRole(app, 'RATING_OFFICER');
      const reader = await sessionWithRole(app);

      const ana = await createPlayer(admin.token, { fullName: 'Ana López', clubCode: 'MOCHIS', email: 'ana@example.com', phone: '6671112233' });
      const luis = await createPlayer(admin.token, { fullName: 'Luis Ordoñez', clubCode: 'CULIACAN' });
      await createPlayer(admin.token, { fullName: 'Marta Gil', clubCode: 'MOCHIS' });

      await request(app).patch(`/api/v1/jugadores/${ana.body.id}`).set(...bearer(officer.token)).send({ ratingElo: 1550.6 }).expect(200);
      await request(app).patch(`/api/v1/jugadores/${luis.body.id}`).set(...bearer(officer.token)).send({ ratingElo: 1800 }).expect(200);

      const byClub = await request(app).get('/api/v1/jugadores?club=mochis').set(...bearer(reader.token)).expect(200);
      expect(byClub.body.meta.total).toBe(2);
      for (const player of byClub.body.data) {
        expect(player.email).toBeUndefined();
        expect(player.phone).toBeUndefined();
        expect(player.birthDate).toBeUndefined();
      }

      const byRating = await request(app)
        .get('/api/v1/jugadores?ratingMin=1600')
        .set(...bearer(reader.token))
        .expect(200);
      expect(byRating.body.data.map((p: { fullName: string }) => p.fullName)).toEqual(['Luis Ordoñez']);

      const range = await request(app)
        .get('/api/v1/jugadores?ratingMin=1500&ratingMax=1900&sortBy=ratingElo&order=DESC')
        .set(...bearer(reader.token))
        .expect(200);
      expect(range.body.data.map((p: { ratingElo: number }) => p.ratingElo)).toEqual([1800, 1550.6]);

      const search = await request(app).get('/api/v1/jugadores?q=ordo%C3%B1ez').set(...bearer(reader.token)).expect(200);
      expect(search.body.meta.total).toBe(1);

      const asAdmin = await request(app).get('/api/v1/jugadores?club=mochis').set(...bearer(admin.token)).expect(200);
      expect(asAdmin.body.data.some((p: { email?: string }) => p.email === 'ana@example.com')).toBe(true);
    });

    it('los jugadores sin rating quedan al final al ordenar por rating', async () => {
      const admin = await sessionWithRole(app, 'SUPER_ADMIN');
      const sinRating = await createPlayer(admin.token, { fullName: 'Sin Rating Uno' });
      const conRating = await createPlayer(admin.token, { fullName: 'Con Rating Dos' });
      await request(app).patch(`/api/v1/jugadores/${conRating.body.id}`).set(...bearer(admin.token)).send({ ratingElo: 1000 }).expect(200);

      for (const order of ['asc', 'desc']) {
        const res = await request(app)
          .get(`/api/v1/jugadores?sortBy=ratingElo&order=${order}`)
          .set(...bearer(admin.token))
          .expect(200);
        expect(res.body.data.map((p: { id: string }) => p.id)).toEqual([conRating.body.id, sinRating.body.id]);
      }
    });

    it.each([
      'page=0',
      'limit=101',
      'sortBy=email',
      'order=up',
      'ratingMin=-1',
      'ratingMax=4000',
      'ratingMin=abc',
      'ratingMin=2000&ratingMax=1000',
      'status=BORRADO',
      'federation=MEXICO',
    ])('422: parámetro inválido %s', async (query) => {
      const { token } = await sessionWithRole(app);
      const res = await request(app).get(`/api/v1/jugadores?${query}`).set(...bearer(token)).expect(422);
      expect(res.body.code).toBe('UNPROCESSABLE_ENTITY');
    });
  });

  describe('PATCH /jugadores/:id', () => {
    it('403: un usuario sin rol no edita perfiles', async () => {
      const admin = await sessionWithRole(app, 'SUPER_ADMIN');
      const player = await createPlayer(admin.token, { fullName: 'Ana López' });
      const user = await sessionWithRole(app);
      const res = await request(app)
        .patch(`/api/v1/jugadores/${player.body.id}`)
        .set(...bearer(user.token))
        .send({ clubCode: 'X' })
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('404: el jugador no existe', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await request(app).patch(`/api/v1/jugadores/${MISSING}`).set(...bearer(token)).send({ clubCode: 'X' }).expect(404);
    });

    it('actualiza el perfil y recalcula la llave de nombre', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const player = await createPlayer(token, { fullName: 'Ana López', birthDate: '2010-05-20' });
      const res = await request(app)
        .patch(`/api/v1/jugadores/${player.body.id}`)
        .set(...bearer(token))
        .send({ fullName: 'Ana Sofía López', club: 'MOCHIS', sexo: 'F', status: 'ACTIVE' })
        .expect(200);
      expect(res.body).toMatchObject({ fullName: 'Ana Sofía López', clubCode: 'MOCHIS', sex: 'F', status: 'ACTIVE' });
      const stored = await prisma.player.findUniqueOrThrow({ where: { id: player.body.id } });
      expect(stored.nameKey).toBe('ana lopez sofia');
    });

    it('acepta null para borrar valores opcionales', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const player = await createPlayer(token, { fullName: 'Ana López', clubCode: 'MOCHIS', phone: '6671112233' });
      const res = await request(app)
        .patch(`/api/v1/jugadores/${player.body.id}`)
        .set(...bearer(token))
        .send({ clubCode: null, phone: null })
        .expect(200);
      expect(res.body.clubCode).toBeNull();
      expect(res.body.phone).toBeNull();
    });

    it.each([
      ['cuerpo vacío', {}],
      ['nombre muy corto', { fullName: 'ab' }],
      ['sexo inválido', { sex: 'X' }],
      ['fecha futura', { birthDate: '2999-01-01' }],
      ['correo inválido', { email: 'no-es-correo' }],
      ['estado inválido', { status: 'BORRADO' }],
    ])('400: %s', async (_caso, body) => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const player = await createPlayer(token, { fullName: 'Ana López' });
      const res = await request(app).patch(`/api/v1/jugadores/${player.body.id}`).set(...bearer(token)).send(body).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('409: renombrar a otro jugador existente con la misma fecha', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await createPlayer(token, { fullName: 'Ana López', birthDate: '2010-05-20' }).expect(201);
      const other = await createPlayer(token, { fullName: 'Luis Ordoñez', birthDate: '2010-05-20' }).expect(201);
      const res = await request(app)
        .patch(`/api/v1/jugadores/${other.body.id}`)
        .set(...bearer(token))
        .send({ fullName: 'López Ana' })
        .expect(409);
      expect(res.body.code).toBe('PLAYER_DUPLICATE');
    });

    it('409: un identificador FIDE repetido', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await createPlayer(token, { fullName: 'Ana López', fideId: '5200001' }).expect(201);
      const other = await createPlayer(token, { fullName: 'Luis Ordoñez' }).expect(201);
      await request(app)
        .patch(`/api/v1/jugadores/${other.body.id}`)
        .set(...bearer(token))
        .send({ fideId: '5200001' })
        .expect(409);
    });

    it('editar el mismo jugador sin cambiar su identidad no es duplicado', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const player = await createPlayer(token, { fullName: 'Ana López', birthDate: '2010-05-20' });
      await request(app)
        .patch(`/api/v1/jugadores/${player.body.id}`)
        .set(...bearer(token))
        .send({ fullName: 'Ana López', birthDate: '2010-05-20', clubCode: 'MOCHIS' })
        .expect(200);
    });
  });

  describe('rating (RN-05)', () => {
    it('solo quien tiene rating:update modifica el rating', async () => {
      const admin = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const officer = await sessionWithRole(app, 'RATING_OFFICER');
      const player = await createPlayer(admin.token, { fullName: 'Ana López' });
      const url = `/api/v1/jugadores/${player.body.id}`;

      await request(app).patch(url).set(...bearer(admin.token)).send({ ratingElo: 1500 }).expect(403);
      const ok = await request(app).patch(url).set(...bearer(officer.token)).send({ ratingElo: 1500.5, kFactor: 20 }).expect(200);
      expect(ok.body).toMatchObject({ ratingElo: 1500.5, kFactor: 20 });
    });

    it('el responsable de ratings no edita el resto del perfil', async () => {
      const admin = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const officer = await sessionWithRole(app, 'RATING_OFFICER');
      const player = await createPlayer(admin.token, { fullName: 'Ana López' });
      await request(app)
        .patch(`/api/v1/jugadores/${player.body.id}`)
        .set(...bearer(officer.token))
        .send({ clubCode: 'X' })
        .expect(403);
    });

    it.each([
      ['negativo', -1],
      ['mayor a 3000', 3000.1],
      ['con dos decimales', 1500.55],
      ['texto', 'alto'],
    ])('400: rating %s', async (_caso, ratingElo) => {
      const officer = await sessionWithRole(app, 'SUPER_ADMIN');
      const player = await createPlayer(officer.token, { fullName: 'Ana López' });
      await request(app)
        .patch(`/api/v1/jugadores/${player.body.id}`)
        .set(...bearer(officer.token))
        .send({ ratingElo })
        .expect(400);
    });

    it('400: factor K fuera del conjunto permitido', async () => {
      const officer = await sessionWithRole(app, 'SUPER_ADMIN');
      const player = await createPlayer(officer.token, { fullName: 'Ana López' });
      await request(app)
        .patch(`/api/v1/jugadores/${player.body.id}`)
        .set(...bearer(officer.token))
        .send({ kFactor: 25 })
        .expect(400);
    });

    it('el alta ignora el rating enviado', async () => {
      const { token } = await sessionWithRole(app, 'SUPER_ADMIN');
      const res = await createPlayer(token, { fullName: 'Ana López', ratingElo: 2800 }).expect(201);
      expect(res.body.ratingElo).toBeNull();
    });
  });

  describe('DELETE /jugadores/:id', () => {
    it('403 sin permiso y 404 si no existe', async () => {
      const admin = await sessionWithRole(app, 'SUPER_ADMIN');
      const player = await createPlayer(admin.token, { fullName: 'Ana López' });
      const user = await sessionWithRole(app);
      await request(app).delete(`/api/v1/jugadores/${player.body.id}`).set(...bearer(user.token)).expect(403);
      await request(app).delete(`/api/v1/jugadores/${MISSING}`).set(...bearer(admin.token)).expect(404);
    });

    it('baja lógica: 200, idempotente, conserva el registro y sale del listado', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const player = await createPlayer(token, { fullName: 'Ana López' });
      const url = `/api/v1/jugadores/${player.body.id}`;

      const first = await request(app).delete(url).set(...bearer(token)).expect(200);
      expect(first.body.status).toBe('INACTIVE');
      await request(app).delete(url).set(...bearer(token)).expect(200);

      expect(await prisma.player.count({ where: { id: player.body.id } })).toBe(1);
      const list = await request(app).get('/api/v1/jugadores').set(...bearer(token)).expect(200);
      expect(list.body.data).toHaveLength(0);
      const all = await request(app).get('/api/v1/jugadores?includeInactive=true').set(...bearer(token)).expect(200);
      expect(all.body.data).toHaveLength(1);
      const byStatus = await request(app).get('/api/v1/jugadores?status=INACTIVE').set(...bearer(token)).expect(200);
      expect(byStatus.body.data).toHaveLength(1);
      await request(app).get(url).set(...bearer(token)).expect(200);
    });
  });
});
