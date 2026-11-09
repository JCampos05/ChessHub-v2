export interface GameDto {
  id: string;
  tournamentId: string;
  roundNumber: number;
  pairingId: string | null;
  whitePlayerId: string;
  blackPlayerId: string;
  result: string;
  pgn: string | null;
  playedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function toGameDto(game: GameDto): GameDto {
  return {
    id: game.id,
    tournamentId: game.tournamentId,
    roundNumber: game.roundNumber,
    pairingId: game.pairingId,
    whitePlayerId: game.whitePlayerId,
    blackPlayerId: game.blackPlayerId,
    result: game.result,
    pgn: game.pgn,
    playedAt: game.playedAt,
    isActive: game.isActive,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
  };
}
