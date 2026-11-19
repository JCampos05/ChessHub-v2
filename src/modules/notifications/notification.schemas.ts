import { z } from 'zod';
import { booleanQuery, paginationQuerySchema } from '../../shared/pagination.js';

// «leida» filtra la bandeja: true = leídas, false = pendientes; cualquier otro valor es 422
export const listNotificationsQuerySchema = paginationQuerySchema
  .pick({ page: true, limit: true })
  .extend({ leida: booleanQuery.optional() });

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
