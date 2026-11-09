import type { Permission } from '../../domain/permissions/catalog.js';
import { can, type PermissionContext, type RoleAssignment } from '../../domain/permissions/can.js';
import { userRepository } from '../users/user.repository.js';

export const permissionService = {
  // Roles del usuario con su ámbito, en el formato que usa la lógica de permisos
  async assignmentsOf(userId: string): Promise<RoleAssignment[]> {
    const roles = await userRepository.findRoles(userId);
    return roles.map((entry) => ({
      roleCode: entry.role.code,
      scopeType: entry.scopeType,
      scopeId: entry.scopeId,
    }));
  },

  async can(userId: string, permission: Permission, resource: Omit<PermissionContext, 'userId'> = {}): Promise<boolean> {
    return can(await this.assignmentsOf(userId), permission, { userId, ...resource });
  },
};
