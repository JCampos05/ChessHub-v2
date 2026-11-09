function prismaCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

// Violación de una restricción única
export const isUniqueViolation = (error: unknown): boolean => prismaCode(error) === 'P2002';

// Violación de una clave foránea (referencia a un registro que no existe)
export const isForeignKeyViolation = (error: unknown): boolean => prismaCode(error) === 'P2003';
