interface RoundRow {
  id: string;
  tournamentId: string;
  number: number;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoundDto {
  id: string;
  tournamentId: string;
  number: number;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function toRoundDto(round: RoundRow): RoundDto {
  return {
    id: round.id,
    tournamentId: round.tournamentId,
    number: round.number,
    status: round.status,
    startedAt: round.startedAt,
    finishedAt: round.finishedAt,
    isActive: round.isActive,
    createdAt: round.createdAt,
    updatedAt: round.updatedAt,
  };
}
