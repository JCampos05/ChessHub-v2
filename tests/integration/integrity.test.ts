import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDb } from '../helpers/db.js';
import { makePlayer, makeRound, makeTournament } from '../helpers/factories.js';

// Integridad referencial, restricciones CHECK e índices B-Tree
describe('integridad de datos y diseño físico', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('claves foráneas (RESTRICT)', () => {
    it('no se borra un torneo con rondas', async () => {
      const tournament = await makeTournament();
      await makeRound(tournament.id, 1);
      await expect(prisma.tournament.delete({ where: { id: tournament.id } })).rejects.toMatchObject({
        code: 'P2003',
      });
    });

    it('no se borra un jugador con emparejamientos ni con partidas', async () => {
      const tournament = await makeTournament();
      await makeRound(tournament.id, 1);
      const [a, b] = await Promise.all([makePlayer(), makePlayer()]);
      await prisma.pairing.create({
        data: { tournamentId: tournament.id, roundNumber: 1, board: 1, whitePlayerId: a.id, blackPlayerId: b.id },
      });
      await prisma.game.create({
        data: { tournamentId: tournament.id, roundNumber: 1, whitePlayerId: a.id, blackPlayerId: b.id },
      });
      await expect(prisma.player.delete({ where: { id: a.id } })).rejects.toMatchObject({ code: 'P2003' });
      await expect(prisma.player.delete({ where: { id: b.id } })).rejects.toMatchObject({ code: 'P2003' });
    });

    it('no se borra una categoría vinculada a un torneo', async () => {
      const tournament = await makeTournament();
      const category = await prisma.category.create({ data: { name: 'Sub-12' } });
      await prisma.tournamentCategory.create({
        data: { tournamentId: tournament.id, categoryId: category.id },
      });
      await expect(prisma.category.delete({ where: { id: category.id } })).rejects.toMatchObject({ code: 'P2003' });
    });

    it('un emparejamiento o partida exige una ronda existente del mismo torneo', async () => {
      const tournament = await makeTournament();
      const [a, b] = await Promise.all([makePlayer(), makePlayer()]);
      await expect(
        prisma.pairing.create({
          data: { tournamentId: tournament.id, roundNumber: 3, board: 1, whitePlayerId: a.id, blackPlayerId: b.id },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
      await expect(
        prisma.game.create({
          data: { tournamentId: tournament.id, roundNumber: 3, whitePlayerId: a.id, blackPlayerId: b.id },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });
  });

  describe('restricciones CHECK y únicas', () => {
    it('torneo: fecha final anterior a la inicial, rondas y cupo inválidos', async () => {
      const start = new Date('2026-12-05T00:00:00.000Z');
      const base = { name: 'Torneo CHECK', startDate: start, endDate: start };
      await expect(
        prisma.tournament.create({ data: { ...base, endDate: new Date('2026-12-01T00:00:00.000Z') } }),
      ).rejects.toThrow();
      await expect(prisma.tournament.create({ data: { ...base, roundsPlanned: 0 } })).rejects.toThrow();
      await expect(prisma.tournament.create({ data: { ...base, maxPlayers: 1 } })).rejects.toThrow();
    });

    it('jugador: rating fuera de 0 a 3000', async () => {
      await expect(makePlayer({ ratingElo: 3500 })).rejects.toThrow();
      await expect(makePlayer({ ratingElo: -1 })).rejects.toThrow();
    });

    it('ronda: número menor que 1; emparejamiento: mesa menor que 1 o jugador contra sí mismo', async () => {
      const tournament = await makeTournament();
      await expect(makeRound(tournament.id, 0)).rejects.toThrow();
      await makeRound(tournament.id, 1);
      const [a, b] = await Promise.all([makePlayer(), makePlayer()]);
      await expect(
        prisma.pairing.create({
          data: { tournamentId: tournament.id, roundNumber: 1, board: 0, whitePlayerId: a.id, blackPlayerId: b.id },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.pairing.create({
          data: { tournamentId: tournament.id, roundNumber: 1, board: 1, whitePlayerId: a.id, blackPlayerId: a.id },
        }),
      ).rejects.toThrow();
    });

    it('categoría: el nombre es único sin distinguir mayúsculas', async () => {
      await prisma.category.create({ data: { name: 'Sub-10' } });
      await expect(prisma.category.create({ data: { name: 'SUB-10' } })).rejects.toMatchObject({ code: 'P2002' });
    });

    it('la base impide la misma mesa o el mismo jugador del mismo lado, aun sin pasar por la API', async () => {
      const tournament = await makeTournament();
      await makeRound(tournament.id, 1);
      const [a, b, c, d] = await Promise.all([makePlayer(), makePlayer(), makePlayer(), makePlayer()]);
      const slot = { tournamentId: tournament.id, roundNumber: 1 };
      await prisma.pairing.create({ data: { ...slot, board: 1, whitePlayerId: a.id, blackPlayerId: b.id } });
      await expect(
        prisma.pairing.create({ data: { ...slot, board: 1, whitePlayerId: c.id, blackPlayerId: d.id } }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        prisma.pairing.create({ data: { ...slot, board: 2, whitePlayerId: a.id, blackPlayerId: d.id } }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        prisma.pairing.create({ data: { ...slot, board: 3, whitePlayerId: c.id, blackPlayerId: b.id } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  // Con tablas casi vacías el planificador prefiere recorrerlas completas; se desactiva el barrido
  // secuencial dentro de la transacción para comprobar que el índice es utilizable por la consulta.
  describe('índices B-Tree (RNF-09)', () => {
    async function plan(sql: string): Promise<string> {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        const rows = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(`EXPLAIN ${sql}`);
        return rows.map((row) => row['QUERY PLAN']).join('\n');
      });
    }

    it.each([
      ['players_rating_elo_fide_id_idx', 'SELECT id FROM players WHERE rating_elo BETWEEN 1800 AND 2200'],
      ['players_rating_elo_fide_id_idx', 'SELECT id FROM players ORDER BY rating_elo DESC LIMIT 20'],
      ['players_club_code_idx', "SELECT id FROM players WHERE club_code = 'ABC'"],
      ['tournaments_start_date_idx', "SELECT id FROM tournaments WHERE start_date >= '2026-12-01'"],
      [
        'tournaments_status_start_date_idx',
        "SELECT id FROM tournaments WHERE status = 'IN_PROGRESS' AND start_date >= '2026-12-01'",
      ],
      [
        'games_tournament_id_round_number_idx',
        "SELECT id FROM games WHERE tournament_id = '0190aaaa-0000-7000-8000-000000000099' AND round_number = 1",
      ],
    ])('%s se usa en: %s', async (indexName, sql) => {
      const result = await plan(sql);
      expect(result).toContain(indexName);
      expect(result).not.toMatch(/Seq Scan/);
    });
  });
});
