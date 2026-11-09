import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Permission } from '../domain/permissions/catalog.js';
import { can, type PermissionContext } from '../domain/permissions/can.js';
import { permissionService } from '../modules/auth/permission.service.js';
import { forbidden, notFound, unauthorized } from '../shared/errors.js';

export type ResourceContext = Omit<PermissionContext, 'userId'>;

// Obtiene el torneo y el creador del recurso solicitado. Devuelve null si el recurso no existe
export type ContextResolver = (req: Request) => Promise<ResourceContext | null>;

// Valida en el servidor, en cada petición, el permiso por rol y ámbito
export function authorize(permission: Permission, resolve?: ContextResolver): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const auth = req.auth;
      if (!auth) throw unauthorized('TOKEN_MISSING', 'Falta el token de acceso');

      let resource: ResourceContext = {};
      if (resolve) {
        const resolved = await resolve(req);
        if (resolved === null) throw notFound();
        resource = resolved;
      }

      const assignments = await permissionService.assignmentsOf(auth.userId);
      if (!can(assignments, permission, { userId: auth.userId, ...resource })) {
        const hasPermissionElsewhere = can(assignments, permission, { userId: auth.userId });
        throw hasPermissionElsewhere
          ? forbidden('OUT_OF_SCOPE', 'No tienes permiso sobre este recurso')
          : forbidden('FORBIDDEN', 'No tienes permiso para realizar esta acción');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
