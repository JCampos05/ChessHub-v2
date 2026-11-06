import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createSession, loginUser, registerUser, uniqueEmail, VALID_PASSWORD } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';

const app = createApp();

describe('auth', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /auth/register (RF-ACC-03)', () => {
    it('201: crea la cuenta sin hash ni roles', async () => {
      const { res, email } = await registerUser(app);
      expect(res.status).toBe(201);
      expect(res.body.email).toBe(email);
      expect(res.body.roles).toEqual([]);
      expect(res.body.passwordHash).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('$2');
    });

    it('guarda el correo en minúsculas y el hash con bcrypt', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({ email: '  MAYUS@Example.COM ', password: VALID_PASSWORD })
        .expect(201);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'mayus@example.com' } });
      expect(user.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    });

    it('409: correo duplicado sin distinguir mayúsculas', async () => {
      await registerUser(app, 'dup@example.com');
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'DUP@example.com', password: VALID_PASSWORD });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('400: campos faltantes o vacíos, con errores por campo', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({ email: '' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual(
        expect.arrayContaining(['email', 'password']),
      );
    });

    it('400: contraseña débil y correo inválido', async () => {
      await request(app).post('/api/v1/auth/register').send({ email: 'a@b.com', password: 'corta1' }).expect(400);
      await request(app).post('/api/v1/auth/register').send({ email: 'a@b.com', password: 'sinnumeros' }).expect(400);
      await request(app).post('/api/v1/auth/register').send({ email: 'no-es-correo', password: VALID_PASSWORD }).expect(400);
    });

    it('acepta alias del nombre (P-08)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: uniqueEmail(), password: VALID_PASSWORD, nombre: 'Ana López' })
        .expect(201);
      expect(res.body.fullName).toBe('Ana López');
    });

    it('RNF-02: 10 registros simultáneos con el mismo correo dan exactamente 1 respuesta 201', async () => {
      const email = 'concurrente@example.com';
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          request(app).post('/api/v1/auth/register').send({ email, password: VALID_PASSWORD }),
        ),
      );
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(9);
    });
  });

  describe('POST /auth/login (RF-ACC-01, 02, 04, 06)', () => {
    it('200: devuelve token, refreshToken y usuario', async () => {
      const { email } = await registerUser(app);
      const res = await loginUser(app, email);
      expect(res.status).toBe(200);
      expect(res.body.token).toBe(res.body.accessToken);
      expect(res.body.tokenType).toBe('Bearer');
      expect(res.body.expiresIn).toBe(900);
      expect(res.body.refreshToken).toContain('.');
      expect(res.body.user.email).toBe(email);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });

    it('401: mismo mensaje para contraseña errónea y correo inexistente', async () => {
      const { email } = await registerUser(app);
      const wrongPassword = await loginUser(app, email, 'OtraClave999');
      const unknownEmail = await loginUser(app, 'nadie@example.com');
      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body.code).toBe('INVALID_CREDENTIALS');
      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    });

    it('400: campos vacíos', async () => {
      await request(app).post('/api/v1/auth/login').send({ email: '', password: '' }).expect(400);
      await request(app).post('/api/v1/auth/login').send({}).expect(400);
    });

    it('403: cuenta desactivada', async () => {
      const { email } = await registerUser(app);
      await prisma.user.update({ where: { email }, data: { isActive: false } });
      const res = await loginUser(app, email);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_DISABLED');
    });

    it('429: el quinto fallo consecutivo bloquea la cuenta con Retry-After', async () => {
      const { email } = await registerUser(app);
      for (let i = 0; i < 4; i += 1) {
        expect((await loginUser(app, email, 'Incorrecta1')).status).toBe(401);
      }
      const fifth = await loginUser(app, email, 'Incorrecta1');
      expect(fifth.status).toBe(429);
      expect(fifth.body.code).toBe('ACCOUNT_LOCKED');
      expect(Number(fifth.headers['retry-after'])).toBeGreaterThan(0);

      // Con la contraseña correcta también queda bloqueada.
      expect((await loginUser(app, email)).status).toBe(429);
    });

    it('registra los accesos en la bitácora (RF-AUD-01)', async () => {
      const { email } = await registerUser(app);
      await loginUser(app, email, 'Incorrecta1');
      await loginUser(app, email);
      const events = (await prisma.accessLog.findMany()).map((log) => log.event);
      expect(events).toEqual(expect.arrayContaining(['REGISTER', 'LOGIN_FAILED', 'LOGIN_SUCCESS']));
    });
  });

  describe('GET /auth/me (RF-ACC-10, RF-USU-04)', () => {
    it('200: usuario con roles y ámbitos', async () => {
      const { token, user } = await createSession(app);
      const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
      expect(res.body.id).toBe(user.id);
      expect(res.body.roles).toEqual([]);
      expect(res.body.passwordHash).toBeUndefined();
    });

    it('401 TOKEN_MISSING sin token', async () => {
      const res = await request(app).get('/api/v1/auth/me').expect(401);
      expect(res.body.code).toBe('TOKEN_MISSING');
    });

    it('401 TOKEN_INVALID con token manipulado', async () => {
      const { token } = await createSession(app);
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token.slice(0, -4)}xxxx`)
        .expect(401);
      expect(res.body.code).toBe('TOKEN_INVALID');
    });

    it('401 SESSION_REVOKED con sesión revocada', async () => {
      const { token } = await createSession(app);
      await prisma.session.updateMany({ data: { revokedAt: new Date() } });
      const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
      expect(res.body.code).toBe('SESSION_REVOKED');
    });

    it('401 SESSION_EXPIRED con sesión vencida', async () => {
      const { token } = await createSession(app);
      await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
      expect(res.body.code).toBe('SESSION_EXPIRED');
    });
  });

  describe('POST /auth/refresh-token (RF-ACC-06)', () => {
    it('200: rota el refresh token y el anterior deja de servir', async () => {
      const { refreshToken } = await createSession(app);
      const first = await request(app).post('/api/v1/auth/refresh-token').send({ refreshToken }).expect(200);
      expect(first.body.refreshToken).not.toBe(refreshToken);
      expect(first.body.accessToken).toBeTruthy();

      const reused = await request(app).post('/api/v1/auth/refresh-token').send({ refreshToken });
      expect(reused.status).toBe(401);
      expect(reused.body.code).toBe('REFRESH_TOKEN_INVALID');
    });

    it('reutilizar un token ya rotado revoca la sesión completa', async () => {
      const { refreshToken, token } = await createSession(app);
      const rotated = await request(app).post('/api/v1/auth/refresh').send({ refreshToken }).expect(200);
      await request(app).post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);

      // El token legítimo más reciente tampoco sirve: la sesión fue revocada.
      await request(app).post('/api/v1/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);
      await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    });

    it('401: token inválido o con formato incorrecto; 400 si falta', async () => {
      await request(app).post('/api/v1/auth/refresh-token').send({ refreshToken: 'smoke_test_token' }).expect(401);
      await request(app).post('/api/v1/auth/refresh-token').send({}).expect(400);
    });
  });

  describe('POST /auth/logout (RF-ACC-07)', () => {
    it('revoca la sesión y el access token deja de servir de inmediato', async () => {
      const { token } = await createSession(app);
      await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`).expect(200);
      const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
      expect(res.body.code).toBe('SESSION_REVOKED');
    });

    it('401 sin token', async () => {
      await request(app).post('/api/v1/auth/logout').expect(401);
    });
  });
});
