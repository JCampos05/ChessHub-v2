interface PlayerRow {
  id: string;
  fullName: string;
  birthDate: Date | null;
  sex: string | null;
  federation: string;
  fideId: string | null;
  nationalId: string | null;
  clubCode: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  kFactor: number | null;
  ratingElo: { toString(): string } | null;
  createdAt: Date;
}

export interface PublicPlayerDto {
  id: string;
  fullName: string;
  birthYear: number | null;
  sex: string | null;
  federation: string;
  fideId: string | null;
  clubCode: string | null;
  ratingElo: number | null;
  status: string;
}

export interface PrivatePlayerDto extends PublicPlayerDto {
  birthDate: string | null;
  nationalId: string | null;
  email: string | null;
  phone: string | null;
  kFactor: number | null;
  createdAt: Date;
}

export function toPublicPlayerDto(player: PlayerRow): PublicPlayerDto {
  return {
    id: player.id,
    fullName: player.fullName,
    birthYear: player.birthDate ? player.birthDate.getUTCFullYear() : null,
    sex: player.sex,
    federation: player.federation,
    fideId: player.fideId,
    clubCode: player.clubCode,
    ratingElo: player.ratingElo === null ? null : Number(player.ratingElo.toString()),
    status: player.status,
  };
}

export function toPrivatePlayerDto(player: PlayerRow): PrivatePlayerDto {
  return {
    ...toPublicPlayerDto(player),
    birthDate: player.birthDate ? player.birthDate.toISOString().slice(0, 10) : null,
    nationalId: player.nationalId,
    email: player.email,
    phone: player.phone,
    kFactor: player.kFactor,
    createdAt: player.createdAt,
  };
}
