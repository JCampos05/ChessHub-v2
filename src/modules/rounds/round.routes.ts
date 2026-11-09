import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { uuidParam, validateBody, validateQuery } from '../../shared/validate.js';
import { roundFromParam } from './round.context.js';
import { roundController } from './round.controller.js';
import { createRoundSchema, listRoundsQuerySchema, updateRoundSchema } from './round.schemas.js';

export const roundRouter = Router();

roundRouter.use(authenticate);

roundRouter.get('/', validateQuery(listRoundsQuerySchema), roundController.list);
// El torneo viaja en el cuerpo: el permiso por torneo se evalúa en el servicio
roundRouter.post('/', authorize('round:manage'), validateBody(createRoundSchema), roundController.create);
roundRouter.get('/:id', uuidParam('id'), roundController.getById);
roundRouter.patch('/:id', uuidParam('id'), authorize('round:manage', roundFromParam), validateBody(updateRoundSchema), roundController.update );
roundRouter.delete('/:id', uuidParam('id'), authorize('round:manage', roundFromParam), roundController.remove);
