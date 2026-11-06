import type { NextFunction, Request, Response } from 'express';
import { notFound } from '../shared/errors.js';

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(notFound('La ruta solicitada no existe'));
}
