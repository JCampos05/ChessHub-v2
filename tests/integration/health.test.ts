import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { redisHealth } from '../../src/lib/redis.js';

const app = createApp();

describe('salud y rutas base (RNF-12)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('GET /api/v1/health responde 200 con base de datos activa', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('up');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('informa Redis como deshabilitado cuando no está configurado', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);
    expect(res.body.redis).toBe('disabled');
  });

  it('con Redis caído sigue respondiendo 200: la caché degrada, el servicio no (RNF04)', async () => {
    const spy = vi.spyOn(redisHealth, 'check').mockResolvedValueOnce('down');
    const res = await request(app).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up', redis: 'down' });
    spy.mockRestore();
  });

  it('GET /health responde 200', async () => {
    await request(app).get('/health').expect(200);
  });

  it('GET / responde 200', async () => {
    await request(app).get('/').expect(200);
  });

  it('responde 503 si la base de datos no responde', async () => {
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('caída simulada'));
    const res = await request(app).get('/api/v1/health').expect(503);
    expect(res.body.database).toBe('down');
    spy.mockRestore();
  });

  it('ruta desconocida responde 404 con formato de error', async () => {
    const res = await request(app).get('/api/v1/no-existe').expect(404);
    expect(res.body).toMatchObject({ status: 'error', statusCode: 404, code: 'NOT_FOUND' });
  });

  it('JSON mal formado responde 400 MALFORMED_JSON', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ')
      .expect(400);
    expect(res.body.code).toBe('MALFORMED_JSON');
  });

  it('cuerpo demasiado grande responde 413', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.com', password: 'x'.repeat(200_000) })
      .expect(413);
    expect(res.body.statusCode).toBe(413);
  });
});
