import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { DomainError } from '../lib/errors.js';

/**
 * The single place HTTP status codes are decided.
 *
 * Services throw typed domain errors and know nothing about HTTP; this handler is
 * the only translation layer. Keeping it in one function means a new error type is
 * mapped once rather than at every call site.
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        // Flattened to field -> messages, which is the shape form libraries expect.
        details: error.flatten().fieldErrors,
      },
    });
    return;
  }

  if (error instanceof DomainError) {
    res.status(error.statusCode).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002: unique constraint. Usually a duplicate email, but also the partial
    // index guarding "one current salary record per employee".
    if (error.code === 'P2002') {
      res.status(409).json({
        error: { code: 'CONFLICT', message: 'A record with these values already exists' },
      });
      return;
    }
    // P2003: foreign key violation - a referenced department or country is missing.
    if (error.code === 'P2003') {
      res.status(400).json({
        error: { code: 'INVALID_REFERENCE', message: 'A referenced record does not exist' },
      });
      return;
    }
  }

  // Anything reaching here is unexpected, so it is logged in full but reported
  // opaquely: internal messages and stack traces must not leak to clients.
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
};

/**
 * Wrap an async handler so rejected promises reach the error middleware.
 *
 * Express 5 forwards async rejections automatically, but this stays explicit so the
 * behaviour does not silently depend on the framework version.
 */
export function asyncHandler<T extends RequestHandler>(handler: T): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
