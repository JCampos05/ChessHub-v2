// Cálculo de edad en años cumplidos. Todas las fechas son AAAA-MM-DD (calendario, sin hora).


const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

// Misma fecha years a años antes. El 29 de febrero cae el 28 cuando el año resultante no es bisiesto.
export function shiftYears(date: string, years: number): string {
  const year = Number(date.slice(0, 4)) - years;
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const lastDay = month === 2 && !isLeapYear(year) ? 28 : day;
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(Math.min(day, lastDay), 2)}`;
}

// Años cumplidos por quien nació en birth a la fecha on
export function ageOn(birth: string, on: string): number {
  let age = Number(on.slice(0, 4)) - Number(birth.slice(0, 4));
  while (age > 0 && birth > shiftYears(on, age)) age -= 1;
  return age;
}

export interface BirthDateBounds {
  // Nacidos en esta fecha o antes (edad mínima)
  onOrBefore?: string;
  // Nacidos después de esta fecha (edad máxima)
  after?: string;
}

// Convierte un rango de edades en un rango de fechas de nacimiento, para poder usar índice en lugar de
// calcular la edad fila por fila. Edad >= min  <=>  nacimiento <= hoy - min años.
// Edad <= max  <=>  nacimiento > hoy - (max + 1) años.
export function birthDateBounds(today: string, range: { min?: number | undefined; max?: number | undefined }): BirthDateBounds {
  return {
    ...(range.min === undefined ? {} : { onOrBefore: shiftYears(today, range.min) }),
    ...(range.max === undefined ? {} : { after: shiftYears(today, range.max + 1) }),
  };
}
