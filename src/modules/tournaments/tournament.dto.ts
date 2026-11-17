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
  registeredCount: number;
  timeControl: string | null;
  ratingSystem: string;
  ratingPace: string;
  ratingStateCode: string | null;
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
  // Inscripciones activas (el cupo restante es maxPlayers - registeredCount)
  registeredCount: number;
  timeControl: string | null;
  // Rating con el que se siembra y empareja
  ratingSystem: string;
  ratingPace: string;
  ratingStateCode: string | null;
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
    registeredCount: tournament.registeredCount,
    timeControl: tournament.timeControl,
    ratingSystem: tournament.ratingSystem,
    ratingPace: tournament.ratingPace,
    ratingStateCode: tournament.ratingStateCode,
    status: tournament.status,
    isActive: tournament.isActive,
    createdAt: tournament.createdAt,
    updatedAt: tournament.updatedAt,
  };
}
