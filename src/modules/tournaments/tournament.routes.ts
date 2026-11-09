import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { uuidParam, validateBody, validateQuery } from '../../shared/validate.js';
import { tournamentFromParam } from './tournament.context.js';
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

// Categorías del torneo
tournamentRouter.get(['/:id/categorias', '/:id/categories'], uuidParam('id'), tournamentController.listCategories);
tournamentRouter.put(['/:id/categorias/:categoryId', '/:id/categories/:categoryId'], uuidParam('id'), uuidParam('categoryId'), authorize('tournament:update', tournamentFromParam),tournamentController.linkCategory );
tournamentRouter.delete(['/:id/categorias/:categoryId', '/:id/categories/:categoryId'],uuidParam('id'), uuidParam('categoryId') ,authorize('tournament:update', tournamentFromParam), tournamentController.unlinkCategory );