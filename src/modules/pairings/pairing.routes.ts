import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { uuidParam, validateBody, validateQuery } from '../../shared/validate.js';
import { pairingFromParam } from './pairing.context.js';
import { pairingController } from './pairing.controller.js';
import { createPairingSchema, listPairingsQuerySchema, updatePairingSchema } from './pairing.schemas.js';

export const pairingRouter = Router();

pairingRouter.use(authenticate);

pairingRouter.get('/', validateQuery(listPairingsQuerySchema), pairingController.list);
// El torneo viaja en el cuerpo: el permiso por torneo se evalúa en el servicio
pairingRouter.post('/', authorize('round:manage'), validateBody(createPairingSchema), pairingController.create);
pairingRouter.get('/:id', uuidParam('id'), pairingController.getById);
pairingRouter.patch('/:id', uuidParam('id'), authorize('round:manage', pairingFromParam), validateBody(updatePairingSchema),pairingController.update);
pairingRouter.delete('/:id', uuidParam('id'), authorize('round:manage', pairingFromParam), pairingController.remove);