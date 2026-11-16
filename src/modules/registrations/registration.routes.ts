import { Router } from 'express';
import { uuidParam, validateBody, validateQuery } from '../../shared/validate.js';
import { authorizeOnTournament } from '../tournaments/tournament.context.js';
import { registrationController } from './registration.controller.js';
import { createRegistrationSchema, listRegistrationsQuerySchema } from './registration.schemas.js';

// Se monta bajo /torneos/:id/inscripciones (la autenticación la aplica el router de torneos)
export const registrationRouter = Router({ mergeParams: true });

const manage = authorizeOnTournament('registration:manage');
const confirm = authorizeOnTournament('payment:confirm');

registrationRouter.post('/', manage, validateBody(createRegistrationSchema), registrationController.create);
registrationRouter.get('/', manage, validateQuery(listRegistrationsQuerySchema), registrationController.list);
registrationRouter.delete('/:registrationId', manage, uuidParam('registrationId'), registrationController.cancel);
registrationRouter.patch('/:registrationId/pago', confirm, uuidParam('registrationId'), registrationController.confirmPayment);
registrationRouter.patch('/:registrationId/payment', confirm, uuidParam('registrationId'), registrationController.confirmPayment);
