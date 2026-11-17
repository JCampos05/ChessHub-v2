import { fromDateOnly } from '../../shared/dates.js';

interface RatingRow {
  id: string;
  playerId: string;
  system: string;
  pace: string;
  stateCode: string | null;
  value: { toString(): string };
  validFrom: Date;
  createdAt: Date;
}

export interface RatingDto {
  id: string;
  playerId: string;
  system: string;
  pace: string;
  stateCode: string | null;
  value: number;
  validFrom: string;
  createdAt: Date;
}

export function toRatingDto(rating: RatingRow): RatingDto {
  return {
    id: rating.id,
    playerId: rating.playerId,
    system: rating.system,
    pace: rating.pace,
    stateCode: rating.stateCode,
    value: Number(rating.value.toString()),
    validFrom: fromDateOnly(rating.validFrom),
    createdAt: rating.createdAt,
  };
}
