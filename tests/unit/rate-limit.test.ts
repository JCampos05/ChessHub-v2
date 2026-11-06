import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/middlewares/error-handler.js';
import { createRateLimiter } from '../../src/middlewares/rate-limit.js';

describe('límite de peticiones (RNF-05, C-18)', () => {
  it('responde 429 con Retry-After al superar el límite', async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 60_000, limit: 2, skipInTest: false }));
    app.get('/ping', (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);

    await request(app).get('/ping').expect(200);
    await request(app).get('/ping').expect(200);
    const res = await request(app).get('/ping').expect(429);

    expect(res.body.code).toBe('TOO_MANY_REQUESTS');
    expect(res.body.status).toBe('error');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});
