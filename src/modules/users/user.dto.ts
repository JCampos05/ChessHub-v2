export interface RoleAssignmentDto {
  role: string;
  scopeType: string;
  scopeId: string | null;
}

export interface UserDto {
  id: string;
  email: string;
  fullName: string | null;
  isActive: boolean;
  createdAt: Date;
  roles: RoleAssignmentDto[];
}

interface UserRow {
  id: string;
  email: string;
  fullName: string | null;
  isActive: boolean;
  createdAt: Date;
}

interface RoleRow {
  scopeType: string;
  scopeId: string | null;
  role: { code: string };
}

export function toUserDto(user: UserRow, roles: RoleRow[] = []): UserDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isActive: user.isActive,
    createdAt: user.createdAt,
    roles: roles.map((assignment) => ({
      role: assignment.role.code,
      scopeType: assignment.scopeType,
      scopeId: assignment.scopeId,
    })),
  };
}
