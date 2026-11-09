import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { uuidParam, validateBody, validateQuery } from '../../shared/validate.js';
import { playerController } from './player.controller.js';
import { createPlayerSchema, listPlayersQuerySchema, updatePlayerSchema } from './player.schemas.js';

export const playerRouter = Router();

playerRouter.use(authenticate);

playerRouter.get('/', validateQuery(listPlayersQuerySchema), playerController.list);
// El alta está abierta a cualquier usuario autenticado (contrato de la primera entrega)
playerRouter.post('/', validateBody(createPlayerSchema), playerController.create);
playerRouter.get('/:id', uuidParam('id'), playerController.getById);
// El permiso se evalúa en el servicio según los campos que se modifican (perfil o rating)
playerRouter.patch('/:id', uuidParam('id'), validateBody(updatePlayerSchema), playerController.update);
playerRouter.delete('/:id', uuidParam('id'), authorize('player:manage'), playerController.remove);
