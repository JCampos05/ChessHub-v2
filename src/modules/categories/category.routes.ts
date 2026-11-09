import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { uuidParam, validateBody, validateQuery } from '../../shared/validate.js';
import { categoryController } from './category.controller.js';
import { createCategorySchema, listCategoriesQuerySchema, updateCategorySchema } from './category.schemas.js';

export const categoryRouter = Router();

categoryRouter.use(authenticate);
categoryRouter.get('/', validateQuery(listCategoriesQuerySchema), categoryController.list);
categoryRouter.post('/', authorize('catalog:manage'), validateBody(createCategorySchema), categoryController.create);
categoryRouter.get('/:id', uuidParam('id'), categoryController.getById);
categoryRouter.patch('/:id', uuidParam('id'), authorize('catalog:manage'), validateBody(updateCategorySchema), categoryController.update);
categoryRouter.delete('/:id', uuidParam('id'), authorize('catalog:manage'), categoryController.remove);