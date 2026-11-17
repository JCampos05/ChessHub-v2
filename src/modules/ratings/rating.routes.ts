import { Router } from 'express';
import { authorize } from '../../middlewares/authorize.js';
import { validateBody, validateQuery } from '../../shared/validate.js';
import { ratingController } from './rating.controller.js';
import { createRatingSchema, listRatingsQuerySchema } from './rating.schemas.js';

// Se monta bajo /jugadores/:id/ratings (la autenticación y el id los aplica el router de jugadores)
export const ratingRouter = Router({ mergeParams: true });

ratingRouter.get('/', validateQuery(listRatingsQuerySchema), ratingController.list);
ratingRouter.post('/', authorize('rating:update'), validateBody(createRatingSchema), ratingController.create);
