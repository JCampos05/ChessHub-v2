import { createHash } from 'node:crypto';
import { prisma } from './db.js';

// Carga de tablas grandes para las pruebas de rendimiento. Usa Prisma por lotes
// para no exceder el límite de parámetros de PostgreSQL.

const BATCH = 1_000;
const PLAYERS_EPOCH = new Date('1960-01-01T00:00:00.000Z');
const TOURNAMENTS_EPOCH = new Date('2020-01-01T00:00:00.000Z');

const md5 = (value: number): string => createHash('md5').update(String(value)).digest('hex');

const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * 86_400_000);

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) result.push(items.slice(start, start + size));
  return result;
}

export async function seedBulkData(counts: { players: number; tournaments: number }): Promise<void> {
  const players = Array.from({ length: counts.players }, (_, index) => {
    const i = index + 1;
    const name = `jugador ${md5(i)}`;
    return {
      fullName: name,
      normalizedName: name,
      nameKey: `jugador-${i}`,
      status: i % 20 === 0 ? ('INACTIVE' as const) : ('ACTIVE' as const),
      ratingElo: Math.round((800 + Math.random() * 2000) * 10) / 10,
      birthDate: addDays(PLAYERS_EPOCH, i % 20_000),
      clubCode: `CLUB${i % 50}`,
    };
  });
  for (const batch of chunks(players, BATCH)) await prisma.player.createMany({ data: batch });

  const tournaments = Array.from({ length: counts.tournaments }, (_, index) => {
    const i = index + 1;
    const start = addDays(TOURNAMENTS_EPOCH, i % 2500);
    return {
      name: `Torneo ${md5(i)}`,
      city: `Ciudad ${md5(i % 400)}`,
      venue: `Sede ${md5(i * 7)}`,
      startDate: start,
      endDate: addDays(start, 1),
      status: i % 100 === 0 ? ('IN_PROGRESS' as const) : ('FINISHED' as const),
    };
  });
  for (const batch of chunks(tournaments, BATCH)) await prisma.tournament.createMany({ data: batch });

  // Estadísticas actualizadas: sin ellas el planificador no estima bien la selectividad
  await prisma.$executeRawUnsafe('ANALYZE players');
  await prisma.$executeRawUnsafe('ANALYZE tournaments');
}
