import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { bearer, grantScopedRole, sessionWithRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';
import { makePlayer, makeTournament } from '../helpers/factories.js';

const app = createApp();
const MISSING = '0190aaaa-0000-7000-8000-000000000099';

let categorySeq = 0;

// Torneo con una categoría vinculada (sin límite de edad salvo que se indique)
async function setupTournament(
  tournament: Parameters<typeof makeTournament>[0] = {},
  category: { minAge?: number; maxAge?: number } = {},
) {
  const t = await makeTournament(tournament);
  categorySeq += 1;
  const c = await prisma.category.create({ data: { name: `Categoría ${categorySeq}`, ...category } });
  await prisma.tournamentCategory.create({ data: { tournamentId: t.id, categoryId: c.id } });
  return { tournament: t, category: c };
}

describe('inscripciones (RF15, RF18, RN-10, RN-11)', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const post = (token: string, tournamentId: string, body: unknown) =>
    request(app)
      .post(`/api/v1/torneos/${tournamentId}/inscripciones`)
      .set(...bearer(token))
      .send(body as object);

  describe('autenticación y permisos', () => {
    it('401 sin token', async () => {
      await request(app).post(`/api/v1/torneos/${MISSING}/inscripciones`).send({}).expect(401);
      await request(app).get(`/api/v1/torneos/${MISSING}/inscripciones`).expect(401);
    });

    it('un usuario sin rol recibe 403 aunque el id no sea válido', async () => {
      const { token } = await sessionWithRole(app);
      await request(app)
        .post('/api/v1/torneos/1/inscripciones')
        .set(...bearer(token))
        .send({})
        .expect(403);
    });

    it('el organizador de un torneo no inscribe en otro (403 OUT_OF_SCOPE)', async () => {
      const mine = await setupTournament();
      const other = await setupTournament();
      const player = await makePlayer();
      const { token, user } = await sessionWithRole(app);
      await grantScopedRole(user.id, 'ORGANIZER', 'TOURNAMENT', mine.tournament.id);

      await post(token, mine.tournament.id, { playerId: player.id, categoryId: mine.category.id }).expect(201);
      const res = await post(token, other.tournament.id, { playerId: player.id, categoryId: other.category.id }).expect(403);
      expect(res.body.code).toBe('OUT_OF_SCOPE');
      await request(app)
        .get(`/api/v1/torneos/${other.tournament.id}/inscripciones`)
        .set(...bearer(token))
        .expect(403);
    });

    it('un torneo inexistente o un id malformado responden 404', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await post(token, MISSING, {}).expect(404);
      await post(token, 'no-es-uuid', {}).expect(404);
    });

    it('el árbitro de mesa no inscribe (403)', async () => {
      const { tournament, category } = await setupTournament();
      const player = await makePlayer();
      const { token } = await sessionWithRole(app, 'ARBITER');
      await post(token, tournament.id, { playerId: player.id, categoryId: category.id }).expect(403);
    });
  });

  describe('alta', () => {
    it('400 con un cuerpo inválido', async () => {
      const { tournament } = await setupTournament();
      const { token } = await sessionWithRole(app, 'ORGANIZER');
      const res = await post(token, tournament.id, {}).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      await post(token, tournament.id, { playerId: 'x', categoryId: 'y' }).expect(400);
    });

    it('201 con folio consecutivo, pago pendiente, cupo reservado y sin datos de contacto', async () => {
      const { tournament, category } = await setupTournament({ maxPlayers: 8 });
      const a = await makePlayer({ phone: '6671234567', email: 'a@example.com' });
      const b = await makePlayer();
      const { token } = await sessionWithRole(app, 'ORGANIZER');

      const first = await post(token, tournament.id, { playerId: a.id, categoryId: category.id }).expect(201);
      const second = await post(token, tournament.id, { playerId: b.id, categoryId: category.id }).expect(201);

      expect(first.body).toMatchObject({
        tournamentId: tournament.id,
        playerId: a.id,
        folio: 1,
        status: 'ACTIVE',
        paymentStatus: 'PENDING',
      });
      expect(second.body.folio).toBe(2);
      expect(JSON.stringify(first.body)).not.toMatch(/6671234567|a@example\.com|phone|email/);

      const stored = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
      expect(stored).toMatchObject({ registeredCount: 2, registrationCounter: 2 });
    });

    it('acepta la ruta y los campos en inglés o con alias en español', async () => {
      const { tournament, category } = await setupTournament();
      const player = await makePlayer();
      const { token } = await sessionWithRole(app, 'ORGANIZER');
      await request(app)
        .post(`/api/v1/tournaments/${tournament.id}/registrations`)
        .set(...bearer(token))
        .send({ jugadorId: player.id, categoriaId: category.id })
        .expect(201);
    });

    it('409 ALREADY_REGISTERED si ya está inscrito y la reserva de cupo y folio se revierte', async () => {
      const { tournament, category } = await setupTournament({ maxPlayers: 5 });
      const player = await makePlayer();
      const { token } = await sessionWithRole(app, 'ORGANIZER');
      const body = { playerId: player.id, categoryId: category.id };

      await post(token, tournament.id, body).expect(201);
      const res = await post(token, tournament.id, body).expect(409);
      expect(res.body.code).toBe('ALREADY_REGISTERED');

      const stored = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
      expect(stored).toMatchObject({ registeredCount: 1, registrationCounter: 1 });
      expect(await prisma.registration.count({ where: { tournamentId: tournament.id } })).toBe(1);
    });

    it('409 CAPACITY_FULL cuando se agotó el cupo', async () => {
      const { tournament, category } = await setupTournament({ maxPlayers: 2 });
      const [a, b, c] = await Promise.all([makePlayer(), makePlayer(), makePlayer()]);
      const { token } = await sessionWithRole(app, 'ORGANIZER');

      await post(token, tournament.id, { playerId: a.id, categoryId: category.id }).expect(201);
      await post(token, tournament.id, { playerId: b.id, categoryId: category.id }).expect(201);
      const res = await post(token, tournament.id, { playerId: c.id, categoryId: category.id }).expect(409);
      expect(res.body.code).toBe('CAPACITY_FULL');

      // El rechazo no consume cupo ni folio
      const stored = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
      expect(stored).toMatchObject({ registeredCount: 2, registrationCounter: 2 });
    });

    it('409 REGISTRATION_CLOSED si el torneo no está en convocatoria', async () => {
      const { tournament, category } = await setupTournament({ status: 'REGISTRATION_CLOSED' });
      const player = await makePlayer();
      const { token } = await sessionWithRole(app, 'ORGANIZER');
      const res = await post(token, tournament.id, { playerId: player.id, categoryId: category.id }).expect(409);
      expect(res.body.code).toBe('REGISTRATION_CLOSED');
    });

    it('400 REFERENCE_NOT_FOUND con categoría no vinculada, jugador inexistente o inactivo', async () => {
      const { tournament, category } = await setupTournament();
      const unlinked = await prisma.category.create({ data: { name: 'Sin vínculo' } });
      const player = await makePlayer();
      const inactive = await makePlayer({ status: 'INACTIVE' });
      const { token } = await sessionWithRole(app, 'ORGANIZER');

      for (const body of [
        { playerId: player.id, categoryId: unlinked.id },
        { playerId: MISSING, categoryId: category.id },
        { playerId: inactive.id, categoryId: category.id },
      ]) {
        const res = await post(token, tournament.id, body).expect(400);
        expect(res.body.code).toBe('REFERENCE_NOT_FOUND');
      }
      expect(await prisma.registration.count()).toBe(0);
    });

    it('409 AGE_NOT_ELIGIBLE según la edad a la fecha de inicio del torneo (P-35)', async () => {
      // Inicio 2026-12-05: nacido el 2015-06-01 tiene 11 años; nacido en 2005, 21
      const { tournament, category } = await setupTournament({}, { minAge: 10, maxAge: 12 });
      const ok = await makePlayer({ birthDate: new Date('2015-06-01T00:00:00.000Z') });
      const old = await makePlayer({ birthDate: new Date('2005-06-01T00:00:00.000Z') });
      const unknown = await makePlayer();
      const { token } = await sessionWithRole(app, 'ORGANIZER');

      await post(token, tournament.id, { playerId: ok.id, categoryId: category.id }).expect(201);
      for (const player of [old, unknown]) {
        const res = await post(token, tournament.id, { playerId: player.id, categoryId: category.id }).expect(409);
        expect(res.body.code).toBe('AGE_NOT_ELIGIBLE');
      }
    });
  });

  describe('listado', () => {
    it('lista paginada de activas, con filtros y sin datos de contacto', async () => {
      const { tournament, category } = await setupTournament();
      const players = await Promise.all([makePlayer({ phone: '6670000000' }), makePlayer(), makePlayer()]);
      const { token } = await sessionWithRole(app, 'ORGANIZER');
      const ids: string[] = [];
      for (const player of players) {
        const res = await post(token, tournament.id, { playerId: player.id, categoryId: category.id }).expect(201);
        ids.push(res.body.id);
      }
      await request(app)
        .delete(`/api/v1/torneos/${tournament.id}/inscripciones/${ids[2]}`)
        .set(...bearer(token))
        .expect(200);

      const list = await request(app)
        .get(`/api/v1/torneos/${tournament.id}/inscripciones?limit=1&page=2`)
        .set(...bearer(token))
        .expect(200);
      expect(list.body.meta).toMatchObject({ page: 2, limit: 1, total: 2 });
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].folio).toBe(2);
      expect(JSON.stringify(list.body)).not.toMatch(/6670000000|phone|email/);

      const cancelled = await request(app)
        .get(`/api/v1/torneos/${tournament.id}/inscripciones?status=CANCELLED`)
        .set(...bearer(token))
        .expect(200);
      expect(cancelled.body.data.map((r: { folio: number }) => r.folio)).toEqual([3]);

      const all = await request(app)
        .get(`/api/v1/torneos/${tournament.id}/inscripciones?includeInactive=true`)
        .set(...bearer(token))
        .expect(200);
      expect(all.body.meta.total).toBe(3);

      await request(app)
        .get(`/api/v1/torneos/${tournament.id}/inscripciones?paymentStatus=NOPE`)
        .set(...bearer(token))
        .expect(422);
    });
  });

  describe('cancelación', () => {
    it('libera el cupo, conserva el folio, es idempotente y permite reinscribirse', async () => {
      const { tournament, category } = await setupTournament({ maxPlayers: 2 });
      const [player, other, extra] = await Promise.all([makePlayer(), makePlayer(), makePlayer()]);
      const { token } = await sessionWithRole(app, 'ORGANIZER');
      const body = { playerId: player.id, categoryId: category.id };

      const created = await post(token, tournament.id, body).expect(201);
      await post(token, tournament.id, { playerId: other.id, categoryId: category.id }).expect(201);
      await post(token, tournament.id, { playerId: extra.id, categoryId: category.id }).expect(409);

      const url = `/api/v1/torneos/${tournament.id}/inscripciones/${created.body.id}`;
      const cancelled = await request(app).delete(url).set(...bearer(token)).expect(200);
      expect(cancelled.body).toMatchObject({ status: 'CANCELLED', folio: 1 });
      // Cancelar otra vez no libera un segundo cupo
      await request(app).delete(url).set(...bearer(token)).expect(200);

      const afterCancel = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
      expect(afterCancel.registeredCount).toBe(1);

      // El cupo liberado se puede ocupar y el folio anterior no se reutiliza
      const again = await post(token, tournament.id, body).expect(201);
      expect(again.body.folio).toBe(3);
      const afterRegister = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
      expect(afterRegister).toMatchObject({ registeredCount: 2, registrationCounter: 3 });
    });

    it('404 si la inscripción es de otro torneo o no existe', async () => {
      const a = await setupTournament();
      const b = await setupTournament();
      const player = await makePlayer();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const created = await post(token, a.tournament.id, { playerId: player.id, categoryId: a.category.id }).expect(201);

      await request(app)
        .delete(`/api/v1/torneos/${b.tournament.id}/inscripciones/${created.body.id}`)
        .set(...bearer(token))
        .expect(404);
      await request(app)
        .delete(`/api/v1/torneos/${a.tournament.id}/inscripciones/${MISSING}`)
        .set(...bearer(token))
        .expect(404);
    });
  });

  describe('cupo del torneo (RF18)', () => {
    it('el torneo muestra los inscritos y la caché se invalida al inscribir y cancelar', async () => {
      const { tournament, category } = await setupTournament({ maxPlayers: 4 });
      const [a, b] = await Promise.all([makePlayer(), makePlayer()]);
      const { token } = await sessionWithRole(app, 'ORGANIZER');
      const detail = () => request(app).get(`/api/v1/torneos/${tournament.id}`).set(...bearer(token)).expect(200);

      expect((await detail()).body.registeredCount).toBe(0);
      const first = await post(token, tournament.id, { playerId: a.id, categoryId: category.id }).expect(201);
      await post(token, tournament.id, { playerId: b.id, categoryId: category.id }).expect(201);
      expect((await detail()).body.registeredCount).toBe(2);

      await request(app)
        .delete(`/api/v1/torneos/${tournament.id}/inscripciones/${first.body.id}`)
        .set(...bearer(token))
        .expect(200);
      expect((await detail()).body.registeredCount).toBe(1);
    });

    it('409 CAPACITY_BELOW_REGISTERED si se baja el cupo por debajo de lo inscrito', async () => {
      const { tournament, category } = await setupTournament({ maxPlayers: 5 });
      const players = await Promise.all([makePlayer(), makePlayer(), makePlayer()]);
      const { token } = await sessionWithRole(app, 'ORGANIZER');
      for (const player of players) {
        await post(token, tournament.id, { playerId: player.id, categoryId: category.id }).expect(201);
      }
      const patch = (maxPlayers: number | null) =>
        request(app).patch(`/api/v1/torneos/${tournament.id}`).set(...bearer(token)).send({ maxPlayers });

      const res = await patch(2).expect(409);
      expect(res.body.code).toBe('CAPACITY_BELOW_REGISTERED');
      await patch(3).expect(200);
      await patch(null).expect(200);
    });
  });

  describe('pago (RN-11)', () => {
    it('solo quien tiene payment:confirm lo confirma, una sola vez', async () => {
      const { tournament, category } = await setupTournament();
      const player = await makePlayer();
      const organizer = await sessionWithRole(app, 'ORGANIZER');
      const treasurer = await sessionWithRole(app, 'TREASURER');
      const created = await post(organizer.token, tournament.id, { playerId: player.id, categoryId: category.id }).expect(201);
      const url = `/api/v1/torneos/${tournament.id}/inscripciones/${created.body.id}/pago`;

      await request(app).patch(url).set(...bearer(organizer.token)).expect(403);

      const confirmed = await request(app).patch(url).set(...bearer(treasurer.token)).expect(200);
      expect(confirmed.body.paymentStatus).toBe('CONFIRMED');
      expect(confirmed.body.paymentConfirmedAt).toBeTruthy();

      const again = await request(app).patch(url).set(...bearer(treasurer.token)).expect(409);
      expect(again.body.code).toBe('PAYMENT_ALREADY_CONFIRMED');
    });

    it('409 si la inscripción está cancelada', async () => {
      const { tournament, category } = await setupTournament();
      const player = await makePlayer();
      const admin = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const created = await post(admin.token, tournament.id, { playerId: player.id, categoryId: category.id }).expect(201);
      const base = `/api/v1/torneos/${tournament.id}/inscripciones/${created.body.id}`;
      await request(app).delete(base).set(...bearer(admin.token)).expect(200);

      const res = await request(app).patch(`${base}/pago`).set(...bearer(admin.token)).expect(409);
      expect(res.body.code).toBe('REGISTRATION_CANCELLED');
    });
  });
});
