import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger.js';
import { AppError, type FieldError } from '../shared/errors.js';
import { toFieldErrors } from '../shared/validate.js';

interface ErrorBody {
  status: 'error';
  statusCode: number;
  code: string;
  message: string;
  errors?: FieldError[];
}

function hasProp<K extends string>(value: unknown, key: K): value is Record<K, unknown> {
  return typeof value === 'object' && value !== null && key in value;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let statusCode = 500;
  let body: ErrorBody = {
    status: 'error',
    statusCode,
    code: 'INTERNAL_ERROR',
    message: 'Ocurrió un error interno. Intenta de nuevo más tarde',
  };

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    body = { status: 'error', statusCode, code: err.code, message: err.message };
    if (err.errors) body.errors = err.errors;
    if (err.headers) res.set(err.headers);
  } else if (err instanceof ZodError) {
    statusCode = 400;
    body = {
      status: 'error',
      statusCode,
      code: 'VALIDATION_ERROR',
      message: 'Los datos enviados no son válidos',
      errors: toFieldErrors(err),
    };
  } else if (hasProp(err, 'type') && err.type === 'entity.parse.failed') {
    statusCode = 400;
    body = {
      status: 'error',
      statusCode,
      code: 'MALFORMED_JSON',
      message: 'El cuerpo de la petición no es un JSON válido',
    };
  } else if (hasProp(err, 'type') && err.type === 'entity.too.large') {
    statusCode = 413;
    body = {
      status: 'error',
      statusCode,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'El cuerpo de la petición es demasiado grande',
    };
  } else if (hasProp(err, 'code') && err.code === 'P2003') {
    statusCode = 400;
    body = {
      status: 'error',
      statusCode,
      code: 'REFERENCE_NOT_FOUND',
      message: 'Los datos enviados hacen referencia a un registro que no existe',
    };
  } else if (hasProp(err, 'code') && err.code === 'P2002') {
    statusCode = 409;
    body = {
      status: 'error',
      statusCode,
      code: 'CONFLICT',
      message: 'Ya existe un registro con esos datos',
    };
  }

  if (statusCode >= 500) {
    logger.error({ err, requestId: req.id }, 'Error no controlado');
    body.message = `${body.message} (id de petición: ${String(req.id)})`;
  }

  res.status(statusCode).json(body);
}
