import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { uuidParam, validateBody, validateQuery } from '../../shared/validate.js';
import { gameFromParam } from './game.context.js';
import { gameController } from './game.controller.js';
import { createGameSchema, listGamesQuerySchema, updateGameSchema } from './game.schemas.js';

export const gameRouter = Router();

gameRouter.use(authenticate);

gameRouter.get('/', validateQuery(listGamesQuerySchema), gameController.list);
// El torneo viaja en el cuerpo: el permiso por torneo se evalúa en el servicio
gameRouter.post('/', authorize('game:manage'), validateBody(createGameSchema), gameController.create);
gameRouter.get('/:id', uuidParam('id'), gameController.getById);
gameRouter.patch('/:id', uuidParam('id'), authorize('game:manage', gameFromParam), validateBody(updateGameSchema), gameController.update );
gameRouter.delete('/:id', uuidParam('id'), authorize('game:manage', gameFromParam), gameController.remove);