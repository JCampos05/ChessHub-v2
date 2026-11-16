import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { uuidParam, validateBody, validateQuery } from '../../shared/validate.js';
import { registrationRouter } from '../registrations/registration.routes.js';
import { roundGenerationController } from '../rounds/round-generation.controller.js';
import { authorizeOnTournament, tournamentFromParam } from './tournament.context.js';
import { tournamentController } from './tournament.controller.js';
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

// Categorías del torneo
tournamentRouter.get(['/:id/categorias', '/:id/categories'], uuidParam('id'), tournamentController.listCategories);
tournamentRouter.put(['/:id/categorias/:categoryId', '/:id/categories/:categoryId'], uuidParam('id'), uuidParam('categoryId'), authorize('tournament:update', tournamentFromParam),tournamentController.linkCategory );
tournamentRouter.delete(['/:id/categorias/:categoryId', '/:id/categories/:categoryId'],uuidParam('id'), uuidParam('categoryId') ,authorize('tournament:update', tournamentFromParam), tournamentController.unlinkCategory );