// Catálogo de permisos por rol
export const PERMISSIONS = [
  'tournament:create',
  'tournament:update',
  'catalog:manage',
  'player:manage',
  'rating:update',
  'round:manage',
  'game:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Readonly<Record<string, readonly Permission[]>> = {
  SUPER_ADMIN: PERMISSIONS,
  FEDERATION_ADMIN: [
    'tournament:create',
    'tournament:update',
    'catalog:manage',
    'player:manage',
    'round:manage',
    'game:manage',
  ],
  STATE_ADMIN: ['tournament:create', 'tournament:update', 'player:manage', 'round:manage', 'game:manage'],
  MUNICIPAL_ADMIN: ['tournament:create', 'tournament:update', 'player:manage', 'round:manage', 'game:manage'],
  ORGANIZER: ['tournament:create', 'tournament:update', 'player:manage', 'round:manage', 'game:manage'],
  CHIEF_ARBITER: ['round:manage', 'game:manage'],
  ARBITER: ['game:manage'],
  RATING_OFFICER: ['rating:update'],
  TREASURER: [],
  PLAYER: [],
};

export function rolesWith(permission: Permission): string[] {
  return Object.entries(ROLE_PERMISSIONS)
    .filter(([, permissions]) => permissions.includes(permission))
    .map(([role]) => role);
}
