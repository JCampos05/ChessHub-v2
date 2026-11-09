export interface FieldError {
  field: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly errors?: FieldError[],
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, errors?: FieldError[], code = 'VALIDATION_ERROR') =>
  new AppError(400, code, message, errors);

// El cuerpo menciona un registro (torneo, jugador, categoría...) que no existe o está inactivo
export const referenceNotFound = (field: string, message: string) =>
  new AppError(400, 'REFERENCE_NOT_FOUND', 'Los datos enviados hacen referencia a un registro que no existe', [
    { field, message },
  ]);

export const unauthorized = (code: string, message: string) => new AppError(401, code, message);

export const forbidden = (code: string, message: string) => new AppError(403, code, message);

export const notFound = (message = 'El recurso solicitado no existe') =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (code: string, message: string) => new AppError(409, code, message);

export const unprocessable = (message: string, errors?: FieldError[]) =>
  new AppError(422, 'UNPROCESSABLE_ENTITY', message, errors);

export const tooManyRequests = (code: string, message: string, retryAfterSeconds: number) =>
  new AppError(429, code, message, undefined, { 'Retry-After': String(retryAfterSeconds) });
