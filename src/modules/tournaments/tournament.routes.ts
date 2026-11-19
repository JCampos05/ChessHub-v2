import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { uuidParam, validateBody, validateQuery } from '../../shared/validate.js';
import { registrationRouter } from '../registrations/registration.routes.js';
import { roundGenerationController } from '../rounds/round-generation.controller.js';
import { authorizeOnTournament, tournamentFromParam } from './tournament.context.js';
import { tournamentController } from './tournament.controller.js';
import { tournamentStateController } from './state/tournament-state.controller.js';
import { changeStateSchema, namedStateSchema, stateHistoryQuerySchema } from './state/tournament-state.schemas.js';
import {
  createTournamentSchema,
  listTournamentsQuerySchema,
  updateTournamentSchema,
} from './tournament.schemas.js';

export const tournamentRouter = Router();

tournamentRouter.use(authenticate);

tournamentRouter.get('/', validateQuery(listTournamentsQuerySchema), tournamentController.list);
tournamentRouter.post('/', authorize('tournament:create'), validateBody(createTournamentSchema), tournamentController.create);
tournamentRouter.get('/:id', uuidParam('id'), tournamentController.getById);
tournamentRouter.patch('/:id', uuidParam('id'), authorize('tournament:update', tournamentFromParam), validateBody(updateTournamentSchema), tournamentController.update );
tournamentRouter.delete('/:id', uuidParam('id'), authorize('tournament:update', tournamentFromParam),tournamentController.remove );

// Inscripciones del torneo
tournamentRouter.use(['/:id/inscripciones', '/:id/registrations'], registrationRouter);

// Cierre de la ronda anterior y generación de la siguiente
tournamentRouter.post(['/:id/rondas/generar', '/:id/rounds/generate'], authorizeOnTournament('round:manage'), roundGenerationController.generate );

// Cambios de estado: por el cuerpo (/estado) o por nombre del destino, con el mismo servicio
const manageState = authorizeOnTournament('tournament:update');
tournamentRouter.patch(['/:id/estado', '/:id/status'], manageState, validateBody(changeStateSchema), tournamentStateController.change);

const STATE_ROUTES = {
  convocatoria: 'REGISTRATION_OPEN',
  inscripciones_cerradas: 'REGISTRATION_CLOSED',
  en_juego: 'IN_PROGRESS',
  ronda_en_curso: 'ROUND_IN_PROGRESS',
  finalizado: 'FINISHED',
  cancelado: 'CANCELLED',
} as const;
for (const [name, state] of Object.entries(STATE_ROUTES)) {
  tournamentRouter.patch(`/:id/${name}`, manageState, validateBody(namedStateSchema), tournamentStateController.toState(state));
}

// Historial de cambios de estado: lo lee cualquier usuario autenticado
tournamentRouter.get( ['/:id/historial-estados', '/:id/status-history'], uuidParam('id'), validateQuery(stateHistoryQuerySchema), tournamentStateController.history );

// Categorías del torneo
tournamentRouter.get(['/:id/categorias', '/:id/categories'], uuidParam('id'), tournamentController.listCategories);
tournamentRouter.put(['/:id/categorias/:categoryId', '/:id/categories/:categoryId'], uuidParam('id'), uuidParam('categoryId'), authorize('tournament:update', tournamentFromParam),tournamentController.linkCategory );
tournamentRouter.delete(['/:id/categorias/:categoryId', '/:id/categories/:categoryId'],uuidParam('id'), uuidParam('categoryId') ,authorize('tournament:update', tournamentFromParam), tournamentController.unlinkCategory );