import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createSession, grantRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';

const app = createApp();

describe('players', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /players (RF-JUG-01, 02, 05)', () => {
    it('401 sin token', async () => {
      await request(app).post('/api/v1/players').send({ fullName: 'Ana López' }).expect(401);
    });

    it('201: crea el jugador y calcula la llave de nombre', async () => {
      const { token } = await createSession(app);
      const res = await request(app)
        .post('/api/v1/players')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Cruz Urías Walter', birthDate: '2014-02-16', sex: 'M' })
        .expect(201);

      expect(res.body.fullName).toBe('Cruz Urías Walter');
      expect(res.body.status).toBe('PENDING');
      const stored = await prisma.player.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(stored.nameKey).toBe('cruz urias walter');
      expect(stored.normalizedName).toBe('cruz urias walter');
    });

    it('acepta alias del nombre (P-08)', async () => {
      const { token } = await createSession(app);
      await request(app)
        .post('/api/v1/players')
        .set('Authorization', `Bearer ${token}`)
        .send({ nombre: 'Luis Ordoñez' })
        .expect(201);
    });

    it('400: sin nombre, fecha inválida o sexo inválido', async () => {
      const { token } = await createSession(app);
      const post = (body: object) =>
        request(app).post('/api/v1/players').set('Authorization', `Bearer ${token}`).send(body);

      const missing = await post({});
      expect(missing.status).toBe(400);
      expect(missing.body.errors[0].field).toBe('fullName');
      await post({ fullName: 'Ana López', birthDate: '2014-13-45' }).expect(400);
      await post({ fullName: 'Ana López', sex: 'X' }).expect(400);
    });

    it('409 PLAYER_DUPLICATE: mismo nombre (en otro orden) y misma fecha', async () => {
      const { token } = await createSession(app);
      const post = (body: object) =>
        request(app).post('/api/v1/players').set('Authorization', `Bearer ${token}`).send(body);

      await post({ fullName: 'Cruz Urías Walter', birthDate: '2014-02-16' }).expect(201);
      const dup = await post({ fullName: 'Walter Cruz Urias', birthDate: '2014-02-16' });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('PLAYER_DUPLICATE');
    });

    it('mismo nombre con fecha distinta no es duplicado', async () => {
      const { token } = await createSession(app);
      const post = (body: object) =>
        request(app).post('/api/v1/players').set('Authorization', `Bearer ${token}`).send(body);

      await post({ fullName: 'Ana López', birthDate: '2010-01-01' }).expect(201);
      await post({ fullName: 'Ana López', birthDate: '2011-01-01' }).expect(201);
    });

    it('409: sin fecha se compara solo por nombre', async () => {
      const { token } = await createSession(app);
      const post = (body: object) =>
        request(app).post('/api/v1/players').set('Authorization', `Bearer ${token}`).send(body);

      await post({ fullName: 'Ana López' }).expect(201);
      const dup = await post({ fullName: 'López Ana' });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('PLAYER_DUPLICATE');
    });
  });

  describe('GET /players/:id (RN-07, RNF-04)', () => {
    it('401 sin token', async () => {
      await request(app).get('/api/v1/players/0190d3c2-0000-7000-8000-000000000000').expect(401);
    });

    it('200 con DTO público: sin email, teléfono ni fecha completa', async () => {
      const { token } = await createSession(app);
      const created = await request(app)
        .post('/api/v1/players')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Ana López', birthDate: '2010-05-20', email: 'ana@example.com', phone: '6671234567' })
        .expect(201);

      const res = await request(app)
        .get(`/api/v1/players/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.fullName).toBe('Ana López');
      expect(res.body.birthYear).toBe(2010);
      expect(res.body.email).toBeUndefined();
      expect(res.body.phone).toBeUndefined();
      expect(res.body.birthDate).toBeUndefined();
    });

    it('200 con DTO privado para SUPER_ADMIN', async () => {
      const { token, user } = await createSession(app);
      await grantRole(user.id, 'SUPER_ADMIN');
      const created = await request(app)
        .post('/api/v1/players')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Ana López', email: 'ana@example.com', phone: '6671234567' })
        .expect(201);

      const res = await request(app)
        .get(`/api/v1/players/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.email).toBe('ana@example.com');
      expect(res.body.phone).toBe('6671234567');
    });

    it('404: id inexistente o con formato inválido', async () => {
      const { token } = await createSession(app);
      await request(app)
        .get('/api/v1/players/0190d3c2-0000-7000-8000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      await request(app).get('/api/v1/players/1').set('Authorization', `Bearer ${token}`).expect(404);
    });
  });
});
