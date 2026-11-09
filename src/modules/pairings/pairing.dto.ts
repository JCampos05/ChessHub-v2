interface PairingRow {
  id: string;
  tournamentId: string;
  roundNumber: number;
  board: number;
  whitePlayerId: string;
  blackPlayerId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PairingDto extends PairingRow {
  isBye: boolean;
}

export function toPairingDto(pairing: PairingRow): PairingDto {
  return {
    id: pairing.id,
    tournamentId: pairing.tournamentId,
    roundNumber: pairing.roundNumber,
    board: pairing.board,
    whitePlayerId: pairing.whitePlayerId,
    blackPlayerId: pairing.blackPlayerId,
    isBye: pairing.blackPlayerId === null,
    isActive: pairing.isActive,
    createdAt: pairing.createdAt,
    updatedAt: pairing.updatedAt,
  };
}
