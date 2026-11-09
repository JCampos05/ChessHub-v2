import { prisma } from '../../src/lib/prisma.js';

export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE games, pairings, rounds, tournament_categories, tournaments, categories, access_logs, sessions, user_roles, players, users RESTART IDENTITY CASCADE',
  );
}

export { prisma };
