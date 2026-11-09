import type { Prisma } from '../../src/generated/prisma/client.js';
import { prisma } from './db.js';

let counter = 0;
const next = () => (counter += 1);

export function makeTournament(overrides: Partial<Prisma.TournamentUncheckedCreateInput> = {}) {
  const n = next();
  return prisma.tournament.create({
    data: {
      name: `Torneo de prueba ${n}`,
      startDate: new Date('2026-12-05T00:00:00.000Z'),
      endDate: new Date('2026-12-06T00:00:00.000Z'),
      ...overrides,
    },
  });
}

export function makePlayer(overrides: Partial<Prisma.PlayerUncheckedCreateInput> = {}) {
  const n = next();
  const fullName = `Jugador Prueba ${n}`;
  return prisma.player.create({
    data: {
      fullName,
      normalizedName: fullName.toLowerCase(),
      nameKey: `${fullName.toLowerCase()}`,
      ...overrides,
    },
  });
}

export function makeRound(
  tournamentId: string,
  number: number,
  overrides: Partial<Prisma.RoundUncheckedCreateInput> = {},
) {
  return prisma.round.create({ data: { tournamentId, number, ...overrides } });
}
