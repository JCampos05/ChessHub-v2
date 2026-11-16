import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDb } from '../helpers/db.js';
import { makePlayer, makeTournament } from '../helpers/factories.js';

// Restricciones de base de datos de las inscripciones
describe('esquema de inscripciones', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  let categorySeq = 0;

  async function setup(overrides: { maxPlayers?: number } = {}) {
    const tournament = await makeTournament(overrides);
    // El nombre de categoría es único sin distinguir mayúsculas
    categorySeq += 1;
    const category = await prisma.category.create({ data: { name: `Libre ${categorySeq}` } });
    await prisma.tournamentCategory.create({ data: { tournamentId: tournament.id, categoryId: category.id } });
    const player = await makePlayer();
    return { tournament, category, player };
  }

  const register = (
    ctx: { tournament: { id: string }; category: { id: string }; player: { id: string } },
    folio: number,
    status: 'ACTIVE' | 'CANCELLED' = 'ACTIVE',
  ) =>
    prisma.registration.create({
      data: {
        tournamentId: ctx.tournament.id,
        categoryId: ctx.category.id,
        playerId: ctx.player.id,
        folio,
        status,
      },
    });

  it('RF15: el torneo nace sin inscritos y con el contador de folio en cero', async () => {
    const { tournament } = await setup();
    expect(tournament.registeredCount).toBe(0);
    expect(tournament.registrationCounter).toBe(0);
  });

  it('RF15: no admite dos inscripciones activas del mismo jugador en el torneo', async () => {
    const ctx = await setup();
    await register(ctx, 1);
    await expect(register(ctx, 2)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('RF15: una inscripción cancelada permite reinscribirse y conserva el historial', async () => {
    const ctx = await setup();
    await register(ctx, 1, 'CANCELLED');
    await register(ctx, 2);
    expect(await prisma.registration.count({ where: { tournamentId: ctx.tournament.id } })).toBe(2);
  });

  it('RF17: el folio no se repite dentro del torneo, aunque la inscripción esté cancelada', async () => {
    const ctx = await setup();
    const other = await makePlayer();
    await register(ctx, 1, 'CANCELLED');
    await expect(register({ ...ctx, player: other }, 1)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('RF17: el mismo folio sí puede existir en otro torneo', async () => {
    const a = await setup();
    const b = await setup();
    await register(a, 1);
    await expect(register(b, 1)).resolves.toBeDefined();
  });

  it('RF15: la categoría debe estar vinculada al torneo', async () => {
    const { tournament, player } = await setup();
    const unlinked = await prisma.category.create({ data: { name: 'Sin vínculo' } });
    await expect(
      prisma.registration.create({
        data: { tournamentId: tournament.id, categoryId: unlinked.id, playerId: player.id, folio: 1 },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('RF15: el folio debe ser positivo', async () => {
    const ctx = await setup();
    await expect(register(ctx, 0)).rejects.toThrow();
  });

  it('RF18: la base impide que los inscritos superen el cupo', async () => {
    const { tournament } = await setup({ maxPlayers: 2 });
    await expect(
      prisma.tournament.update({ where: { id: tournament.id }, data: { registeredCount: 3 } }),
    ).rejects.toThrow();
    await expect(
      prisma.tournament.update({ where: { id: tournament.id }, data: { registeredCount: 2 } }),
    ).resolves.toMatchObject({ registeredCount: 2 });
  });

  it('RF18: sin cupo máximo no hay tope, pero el contador no puede ser negativo', async () => {
    const { tournament } = await setup();
    await expect(
      prisma.tournament.update({ where: { id: tournament.id }, data: { registeredCount: 500 } }),
    ).resolves.toMatchObject({ registeredCount: 500 });
    await expect(
      prisma.tournament.update({ where: { id: tournament.id }, data: { registeredCount: -1 } }),
    ).rejects.toThrow();
  });

  it('RF16: los emparejamientos existentes y los manuales nacen con origen MANUAL', async () => {
    const tournament = await makeTournament();
    await prisma.round.create({ data: { tournamentId: tournament.id, number: 1 } });
    const [a, b] = await Promise.all([makePlayer(), makePlayer()]);
    const pairing = await prisma.pairing.create({
      data: { tournamentId: tournament.id, roundNumber: 1, board: 1, whitePlayerId: a.id, blackPlayerId: b.id },
    });
    expect(pairing.origin).toBe('MANUAL');
  });
});
