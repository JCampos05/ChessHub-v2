import request from 'supertest';
import type { Express } from 'express';
import { prisma } from './db.js';

export const VALID_PASSWORD = 'Clave12345';

let counter = 0;

export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}${counter}-${Date.now()}@example.com`;
}

export async function registerUser(app: Express, email = uniqueEmail(), password = VALID_PASSWORD) {
  const res = await request(app).post('/api/v1/auth/register').send({ email, password, fullName: 'Persona de Prueba' });
  return { email, password, res };
}

export async function loginUser(app: Express, email: string, password = VALID_PASSWORD) {
  return request(app).post('/api/v1/auth/login').send({ email, password });
}

export async function createSession(app: Express) {
  const { email } = await registerUser(app);
  const res = await loginUser(app, email);
  return { email, ...(res.body as { token: string; refreshToken: string; user: { id: string } }) };
}

export async function grantRole(userId: string, roleCode: string): Promise<void> {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  await prisma.userRole.create({ data: { userId, roleId: role.id, scopeType: 'FEDERATION' } });
}
