interface RegistrationRow {
  id: string;
  tournamentId: string;
  categoryId: string;
  playerId: string;
  folio: number;
  status: string;
  paymentStatus: string;
  paymentConfirmedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  player: { id: string; fullName: string };
}

// Nunca incluye teléfono ni correo del jugador (C-17)
export interface RegistrationDto {
  id: string;
  tournamentId: string;
  categoryId: string;
  playerId: string;
  folio: number;
  status: string;
  paymentStatus: string;
  paymentConfirmedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  player: { id: string; fullName: string };
}

export function toRegistrationDto(row: RegistrationRow): RegistrationDto {
  return {
    id: row.id,
    tournamentId: row.tournamentId,
    categoryId: row.categoryId,
    playerId: row.playerId,
    folio: row.folio,
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentConfirmedAt: row.paymentConfirmedAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    player: { id: row.player.id, fullName: row.player.fullName },
  };
}
