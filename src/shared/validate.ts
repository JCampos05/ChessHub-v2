import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodError, ZodType } from 'zod';
import { badRequest, notFound, unprocessable, type FieldError } from './errors.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toFieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || 'body',
    message: issue.message,
  }));
}

export function validateBody(schema: ZodType): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      return next(badRequest('Los datos enviados no son válidos', toFieldErrors(result.error)));
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodType): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(unprocessable('Los parámetros de consulta no son válidos', toFieldErrors(result.error)));
    }
    res.locals['query'] = result.data;
    next();
  };
}

export function uuidParam(name: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const value = req.params[name];
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      return next(notFound());
    }
    next();
  };
}
