import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../../src/domain/permissions/catalog.js';
import { can, type RoleAssignment } from '../../src/domain/permissions/can.js';

const USER = '0190aaaa-0000-7000-8000-000000000001';
const OTHER = '0190aaaa-0000-7000-8000-000000000002';
const TOURNAMENT_A = '0190bbbb-0000-7000-8000-00000000000a';
const TOURNAMENT_B = '0190bbbb-0000-7000-8000-00000000000b';

const federation = (roleCode: string): RoleAssignment => ({ roleCode, scopeType: 'FEDERATION', scopeId: null });
const inTournament = (roleCode: string, scopeId: string): RoleAssignment => ({
  roleCode,
  scopeType: 'TOURNAMENT',
  scopeId,
});

describe('catálogo de permisos (RF-ROL-02, RF-ROL-04)', () => {
  it('solo contiene permisos conocidos', () => {
    for (const permissions of Object.values(ROLE_PERMISSIONS)) {
      for (const permission of permissions) expect(PERMISSIONS).toContain(permission);
    }
  });

  it('SUPER_ADMIN tiene todos los permisos', () => {
    expect([...ROLE_PERMISSIONS['SUPER_ADMIN']!].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('el rol de jugador no tiene permisos administrativos', () => {
    expect(ROLE_PERMISSIONS['PLAYER']).toEqual([]);
  });
});

describe('can (RN-08)', () => {
  it('niega a quien no tiene roles', () => {
    expect(can([], 'tournament:create', { userId: USER })).toBe(false);
  });

  it('niega si el rol no incluye el permiso', () => {
    expect(can([federation('ARBITER')], 'tournament:create', { userId: USER })).toBe(false);
    expect(can([federation('PLAYER')], 'game:manage', { userId: USER })).toBe(false);
  });

  it('concede una operación sin recurso con cualquier ámbito', () => {
    const stateAdmin: RoleAssignment = { roleCode: 'STATE_ADMIN', scopeType: 'STATE', scopeId: TOURNAMENT_A };
    expect(can([stateAdmin], 'tournament:create', { userId: USER })).toBe(true);
  });

  it('concede sobre un recurso con rol de federación', () => {
    expect(can([federation('FEDERATION_ADMIN')], 'tournament:update', { userId: USER, tournamentId: TOURNAMENT_A })).toBe(
      true,
    );
  });

  it('concede con ámbito del mismo torneo y niega en otro torneo', () => {
    const organizer = inTournament('ORGANIZER', TOURNAMENT_A);
    expect(can([organizer], 'tournament:update', { userId: USER, tournamentId: TOURNAMENT_A })).toBe(true);
    expect(can([organizer], 'tournament:update', { userId: USER, tournamentId: TOURNAMENT_B })).toBe(false);
  });

  it('el creador conserva el control de su recurso mientras tenga un rol con el permiso', () => {
    const stateAdmin: RoleAssignment = { roleCode: 'STATE_ADMIN', scopeType: 'STATE', scopeId: TOURNAMENT_A };
    expect(can([stateAdmin], 'tournament:update', { userId: USER, ownerId: USER })).toBe(true);
    expect(can([stateAdmin], 'tournament:update', { userId: USER, ownerId: OTHER })).toBe(false);
  });

  it('ser el creador no basta sin un rol con el permiso', () => {
    expect(can([federation('PLAYER')], 'tournament:update', { userId: USER, ownerId: USER })).toBe(false);
  });

  it('solo RATING_OFFICER y SUPER_ADMIN actualizan el rating', () => {
    expect(can([federation('RATING_OFFICER')], 'rating:update', { userId: USER })).toBe(true);
    expect(can([federation('FEDERATION_ADMIN')], 'rating:update', { userId: USER })).toBe(false);
  });
});
