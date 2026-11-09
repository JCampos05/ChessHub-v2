import { fromDateOnly } from '../../shared/dates.js';

interface TournamentRow {
  id: string;
  name: string;
  description: string | null;
  venue: string | null;
  city: string | null;
  startDate: Date;
  endDate: Date;
  roundsPlanned: number | null;
  maxPlayers: number | null;
  timeControl: string | null;
  status: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TournamentDto {
  id: string;
  name: string;
  description: string | null;
  venue: string | null;
  city: string | null;
  startDate: string;
  endDate: string;
  roundsPlanned: number | null;
  maxPlayers: number | null;
  timeControl: string | null;
  status: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function toTournamentDto(tournament: TournamentRow): TournamentDto {
  return {
    id: tournament.id,
    name: tournament.name,
    description: tournament.description,
    venue: tournament.venue,
    city: tournament.city,
    startDate: fromDateOnly(tournament.startDate),
    endDate: fromDateOnly(tournament.endDate),
    roundsPlanned: tournament.roundsPlanned,
    maxPlayers: tournament.maxPlayers,
    timeControl: tournament.timeControl,
    status: tournament.status,
    isActive: tournament.isActive,
    createdAt: tournament.createdAt,
    updatedAt: tournament.updatedAt,
  };
}
