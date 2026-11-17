// Rating vigente de un jugador según la preferencia del torneo (sistema y ritmo) con respaldo ordenado

export const RATING_SYSTEMS = ['FIDE', 'NATIONAL', 'STATE'] as const;
export const RATING_PACES = ['STANDARD', 'RAPID', 'BLITZ'] as const;

export type RatingSystem = (typeof RATING_SYSTEMS)[number];
export type RatingPace = (typeof RATING_PACES)[number];

export interface RatingRecord {
  system: RatingSystem;
  pace: RatingPace;
  // Solo el rating estatal lleva estado
  stateCode: string | null;
  value: number;
  validFrom: Date;
}

export interface RatingPreference {
  system: RatingSystem;
  pace: RatingPace;
  stateCode: string | null;
}

export interface ResolvedRating {
  value: number;
  system: RatingSystem;
  pace: RatingPace;
  stateCode: string | null;
  // RECORD: salió de player_ratings; LEGACY: de la columna players.rating_elo
  source: 'RECORD' | 'LEGACY';
}

// Orden de respaldo cuando el sistema preferido no tiene valor
const FALLBACK_ORDER: readonly RatingSystem[] = ['FIDE', 'NATIONAL', 'STATE'];

const keyOf = (record: Pick<RatingRecord, 'system' | 'pace' | 'stateCode'>) =>
  `${record.system}|${record.pace}|${record.stateCode ?? ''}`;

// El más reciente por sistema, ritmo y estado entre los ya vigentes; los de vigencia futura se ignoran
export function currentRatings(records: readonly RatingRecord[], asOf: Date): RatingRecord[] {
  const latest = new Map<string, RatingRecord>();
  for (const record of records) {
    if (record.validFrom.getTime() > asOf.getTime()) continue;
    const existing = latest.get(keyOf(record));
    if (!existing || record.validFrom.getTime() > existing.validFrom.getTime()) latest.set(keyOf(record), record);
  }
  return [...latest.values()];
}

// Entre varios estados, el estatal más reciente y, a igualdad, el de código menor (determinista)
function pickState(candidates: readonly RatingRecord[], stateCode: string | null): RatingRecord | undefined {
  const matching = stateCode === null ? candidates : candidates.filter((r) => r.stateCode === stateCode);
  return [...matching].sort(
    (a, b) => b.validFrom.getTime() - a.validFrom.getTime() || (a.stateCode ?? '').localeCompare(b.stateCode ?? ''),
  )[0];
}

export function resolveRating(
  records: readonly RatingRecord[],
  preference: RatingPreference,
  asOf: Date,
  legacy: number | null = null,
): ResolvedRating | null {
  const current = currentRatings(records, asOf).filter((r) => r.pace === preference.pace);
  const order = [preference.system, ...FALLBACK_ORDER.filter((system) => system !== preference.system)];

  for (const system of order) {
    const ofSystem = current.filter((r) => r.system === system);
    const found = system === 'STATE' ? pickState(ofSystem, preference.stateCode) : ofSystem[0];
    if (found) {
      return { value: found.value, system, pace: found.pace, stateCode: found.stateCode, source: 'RECORD' };
    }
  }

  // Compatibilidad: la columna única anterior se interpreta como rating estándar
  if (legacy !== null && preference.pace === 'STANDARD') {
    return { value: legacy, system: 'NATIONAL', pace: 'STANDARD', stateCode: null, source: 'LEGACY' };
  }
  return null;
}
