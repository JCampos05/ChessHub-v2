import { resolveRating, type RatingRecord } from '../../domain/ratings/resolve.js';
import { NoValidPairingError, pairRound, type SwissPlayer } from '../../domain/swiss/pair.js';
import type { PlayedPairing } from '../../domain/swiss/scores.js';
import { conflict, notFound } from '../../shared/errors.js';
import { toPairingDto, type PairingDto } from '../pairings/pairing.dto.js';
import { isFrozen } from '../tournaments/tournament-status.js';
import { toRoundDto, type RoundDto } from './round.dto.js';
import { roundGenerationRepository as repo, type Tx } from './round-generation.repository.js';

export interface GeneratedRound extends RoundDto {
  pairings: PairingDto[];
}

type PairingWithGame = Awaited<ReturnType<typeof repo.findPairings>>[number];

// Resultado jugado de una mesa: sin partida activa cuenta como pendiente
const outcomeOf = (pairing: PairingWithGame): PlayedPairing['result'] =>
  pairing.game?.isActive ? pairing.game.result : 'PENDING';

const toHistory = (pairings: PairingWithGame[]): PlayedPairing[] =>
  pairings.map((p) => ({
    roundNumber: p.roundNumber,
    whiteId: p.whitePlayerId,
    blackId: p.blackPlayerId,
    result: p.blackPlayerId === null ? 'PENDING' : outcomeOf(p),
  }));

async function generate(tx: Tx, tournamentId: string): Promise<GeneratedRound> {
  const tournament = await repo.findTournament(tx, tournamentId);
  if (!tournament?.isActive) throw notFound('El torneo no existe');
  if (isFrozen(tournament.status)) {
    throw conflict('TOURNAMENT_NOT_EDITABLE', 'El torneo ya terminó o fue cancelado y no admite cambios');
  }
  // Las rondas solo se generan con el torneo en juego; ROUND_IN_PROGRESS exige cerrar antes la ronda abierta
  if (tournament.status === 'ROUND_IN_PROGRESS') {
    throw conflict(
      'TOURNAMENT_NOT_IN_PROGRESS',
      'El torneo tiene una ronda en curso; ciérrala (todas sus partidas con resultado) antes de generar la siguiente',
    );
  }
  if (tournament.status !== 'IN_PROGRESS') {
    throw conflict('TOURNAMENT_NOT_IN_PROGRESS', 'El torneo aún no inicia; ponlo en juego antes de generar rondas');
  }

  const rounds = await repo.findRounds(tx, tournamentId);
  const last = rounds.find((r) => r.isActive);
  const number = (last?.number ?? 0) + 1;

  if (tournament.roundsPlanned !== null && number > tournament.roundsPlanned) {
    throw conflict('ROUNDS_COMPLETE', 'El torneo ya tiene todas sus rondas generadas');
  }
  if (rounds.some((r) => r.number === number)) {
    throw conflict('ROUND_DUPLICATE', 'El torneo ya tiene una ronda con ese número (puede estar inactiva)');
  }

  const registrations = await repo.findActiveRegistrations(tx, tournamentId);
  if (registrations.length < 2) {
    throw conflict('NOT_ENOUGH_PLAYERS', 'Se necesitan al menos 2 inscripciones activas para generar una ronda');
  }

  const pairings = await repo.findPairings(tx, tournamentId);
  if (last) {
    // La ronda anterior solo se cierra si tiene mesas y todas sus partidas ya tienen resultado
    const previous = pairings.filter((p) => p.roundNumber === last.number);
    const unfinished = previous.length === 0 || previous.some((p) => p.blackPlayerId !== null && outcomeOf(p) === 'PENDING');
    if (unfinished) {
      throw conflict('PREVIOUS_ROUND_UNFINISHED', 'La ronda anterior tiene partidas sin resultado');
    }
  }

  // El rating de siembra sale del sistema y ritmo que declara el torneo, con respaldo ordenado 
  const ratingRows = await repo.findRatings(
    tx,
    registrations.map((r) => r.playerId),
  );
  const ratingsByPlayer = new Map<string, RatingRecord[]>();
  for (const row of ratingRows) {
    const list = ratingsByPlayer.get(row.playerId) ?? [];
    list.push({
      system: row.system,
      pace: row.pace,
      stateCode: row.stateCode,
      value: Number(row.value),
      validFrom: row.validFrom,
    });
    ratingsByPlayer.set(row.playerId, list);
  }
  const preference = {
    system: tournament.ratingSystem,
    pace: tournament.ratingPace,
    stateCode: tournament.ratingStateCode,
  };
  const now = new Date();

  const players: SwissPlayer[] = registrations.map((r) => ({
    id: r.playerId,
    folio: r.folio,
    rating: resolveRating(
      ratingsByPlayer.get(r.playerId) ?? [],
      preference,
      now,
      r.player.ratingElo === null ? null : Number(r.player.ratingElo),
    )?.value ?? null,
  }));

  let planned;
  try {
    planned = pairRound({ players, history: toHistory(pairings) });
  } catch (error) {
    if (error instanceof NoValidPairingError) throw conflict('NO_VALID_PAIRING', error.message);
    throw error;
  }

  // Todo lo siguiente ocurre en la misma transacción: si algo falla, no queda nada a medias
  if (last && last.status !== 'FINISHED') await repo.closeRound(tx, tournamentId, last.number);
  const round = await repo.createRound(tx, tournamentId, number);
  const created = [];
  for (const pairing of planned) created.push(await repo.createPairing(tx, tournamentId, number, pairing));

  return { ...toRoundDto(round), pairings: created.map(toPairingDto) };
}

export const roundGenerationService = {
  generate(tournamentId: string): Promise<GeneratedRound> {
    return repo.runLocked(tournamentId, (tx) => generate(tx, tournamentId));
  },
};
