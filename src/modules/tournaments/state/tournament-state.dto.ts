interface StateChangeRow {
  id: string;
  entityType: string;
  entityId: string;
  fromState: string;
  toState: string;
  changedById: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface StateChangeDto {
  id: string;
  entityType: string;
  entityId: string;
  from: string;
  to: string;
  changedById: string | null;
  reason: string | null;
  createdAt: Date;
}

export function toStateChangeDto(row: StateChangeRow): StateChangeDto {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    from: row.fromState,
    to: row.toState,
    changedById: row.changedById,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}
