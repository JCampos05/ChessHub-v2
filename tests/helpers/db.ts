import { memoryStore } from '../../src/lib/cache.js';
import { prisma } from '../../src/lib/prisma.js';

export async function resetDb(): Promise<void> {
  // La caché vive en el proceso: sin vaciarla, una prueba vería datos de la anterior
  memoryStore.clear();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE games, pairings, rounds, tournament_categories, tournaments, categories, access_logs, sessions, user_roles, players, users RESTART IDENTITY CASCADE',
  );
}

export { prisma };
