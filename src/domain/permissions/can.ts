import { ROLE_PERMISSIONS, type Permission } from './catalog.js';

export type ScopeType = 'FEDERATION' | 'STATE' | 'MUNICIPALITY' | 'TOURNAMENT';

export interface RoleAssignment {
  roleCode: string;
  scopeType: ScopeType;
  scopeId: string | null;
}

export interface PermissionContext {
  userId: string;
  // Torneo al que pertenece el recurso, si lo hay
  tournamentId?: string | undefined;
  // Quién creó el recurso, quien lo creó y conserva un rol con el permiso puede seguir operándolo
  ownerId?: string | null | undefined;
}

// Decide si un usuario puede ejecutar un permiso
export function can(assignments: readonly RoleAssignment[], permission: Permission, context: PermissionContext): boolean {
  const holders = assignments.filter((assignment) => ROLE_PERMISSIONS[assignment.roleCode]?.includes(permission));
  if (holders.length === 0) return false;

  const hasResource = context.tournamentId !== undefined || context.ownerId !== undefined;
  if (!hasResource) return true;

  if (context.ownerId !== undefined && context.ownerId !== null && context.ownerId === context.userId) return true;

  return holders.some(
    (holder) =>
      holder.scopeType === 'FEDERATION' ||
      (holder.scopeType === 'TOURNAMENT' && context.tournamentId !== undefined && holder.scopeId === context.tournamentId),
  );
}
