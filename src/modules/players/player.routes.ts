import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { uuidParam, validateBody } from '../../shared/validate.js';
import { playerController } from './player.controller.js';
import { createPlayerSchema } from './player.schemas.js';

export const playerRouter = Router();

playerRouter.use(authenticate);
playerRouter.post('/', validateBody(createPlayerSchema), playerController.create);
playerRouter.get('/:id', uuidParam('id'), playerController.getById);
