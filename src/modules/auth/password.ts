import bcrypt from 'bcrypt';
import { env } from '../../config/env.js';

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

let dummyHash: Promise<string> | undefined;

export async function burnPasswordCheck(plain: string): Promise<void> {
  dummyHash ??= bcrypt.hash('contraseña-ficticia-sin-uso', env.BCRYPT_COST);
  await bcrypt.compare(plain, await dummyHash);
}
