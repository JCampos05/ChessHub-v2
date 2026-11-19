import { decideTransition, type TransitionFacts } from '../../../domain/state-machines/tournament.js';
import { cache } from '../../../lib/cache.js';
import { logger } from '../../../lib/logger.js';
import { getNotificationQueue } from '../../../lib/queue.js';
import { AppError, notFound, queueUnavailable } from '../../../shared/errors.js';
import { paginate } from '../../../shared/pagination.js';
import { toStateChangeDto } from './tournament-state.dto.js';
import { tournamentStateRepository as repo } from './tournament-state.repository.js';
import type { StateHistoryQuery } from './tournament-state.schemas.js';
import { toTournamentDto, type TournamentDto } from '../tournament.dto.js';
import { tournamentRepository } from '../tournament.repository.js';
import { TOURNAMENT_CACHE_RESOURCE } from '../tournament.service.js';
import type { Tx } from '../tournament-lock.js';
import type { TournamentStatusCode } from '../tournament-status.js';

type TournamentRow = NonNullable<Awaited<ReturnType<typeof repo.findTournament>>>;
type LastRound = NonNullable<Awaited<ReturnType<typeof repo.findLastRound>>>;

interface GatheredFacts {
  facts: TransitionFacts;
  openRound: LastRound | null;
}

// Lee solo lo que el destino necesita para decidir; el torneo está bloqueado, así que los conteos no cambian hasta confirmar
async function gatherFacts(tx: Tx, tournament: TournamentRow, to: TournamentStatusCode): Promise<GatheredFacts> {
  const needsRegistrations = to === 'IN_PROGRESS';
  const needsRound = to === 'IN_PROGRESS' || to === 'ROUND_IN_PROGRESS' || to === 'FINISHED';
  const needsFinished = to === 'FINISHED';

  const activeRegistrations = needsRegistrations ? await repo.countActiveRegistrations(tx, tournament.id) : 0;
  const finishedRounds = needsFinished ? await repo.countFinishedRounds(tx, tournament.id) : 0;

  let openRound: LastRound | null = null;
  let roundFacts: TransitionFacts['openRound'] = null;
  if (needsRound) {
    const last = await repo.findLastRound(tx, tournament.id);
    if (last && last.status !== 'FINISHED') {
      openRound = last;
      const status = last.status;
      roundFacts = {
        status,
        pairings: await repo.countPairings(tx, tournament.id, last.number),
        pendingGames: await repo.countPendingGames(tx, tournament.id, last.number),
      };
    }
  }

  return {
    facts: { activeRegistrations, roundsPlanned: tournament.roundsPlanned, finishedRounds, openRound: roundFacts },
    openRound,
  };
}

// El trabajo de notificación se encola como último paso de la transacción: si la cola no responde,
// todo se revierte (el estado no cambia) y la petición recibe 503
async function enqueueNotification(changeId: string, tournamentId: string): Promise<void> {
  try {
    await getNotificationQueue().enqueue({ changeId, tournamentId });
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ err: error, changeId, tournamentId }, 'No se pudo encolar la notificación del cambio de estado');
    throw queueUnavailable();
  }
}

export const tournamentStateService = {
  async changeState(
    tournamentId: string,
    to: TournamentStatusCode,
    reason: string | undefined,
    actorId: string,
  ): Promise<TournamentDto> {
    const updated = await repo.runLocked(tournamentId, async (tx) => {
      const tournament = await repo.findTournament(tx, tournamentId);
      if (!tournament?.isActive) throw notFound('El torneo no existe');

      const from = tournament.status;
      const { facts, openRound } = await gatherFacts(tx, tournament, to);
      const decision = decideTransition(from, to, facts);
      if (!decision.ok) throw new AppError(422, decision.code, decision.message);

      if (openRound) {
        if (decision.roundEffect === 'START_ROUND') await repo.startRound(tx, openRound.id, openRound.startedAt ?? new Date());
        if (decision.roundEffect === 'CLOSE_ROUND') await repo.finishRound(tx, openRound.id);
      }
      const saved = await repo.updateStatus(tx, tournamentId, to);
      const change = await repo.createChange(tx, { tournamentId, from, to, changedById: actorId, reason });
      await enqueueNotification(change.id, tournamentId);
      return saved;
    });

    await cache.bump(TOURNAMENT_CACHE_RESOURCE);
    return toTournamentDto(updated);
  },

  async history(tournamentId: string, query: StateHistoryQuery) {
    if (!(await tournamentRepository.findById(tournamentId))) throw notFound('El torneo no existe');
    const { rows, total } = await repo.listChanges(tournamentId, query.page, query.limit);
    return paginate(rows.map(toStateChangeDto), query.page, query.limit, total);
  },
};
