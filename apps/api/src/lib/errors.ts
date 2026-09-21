/**
 * Typed domain errors.
 *
 * Services throw these; one Express error handler maps them to status codes. This
 * keeps HTTP concerns out of business logic - a service should not know what 404 is.
 */

export abstract class DomainError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;

  constructor(message: string, readonly details?: unknown) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class NotFoundError extends DomainError {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';

  constructor(resource: string, identifier?: string) {
    super(identifier ? `${resource} '${identifier}' was not found` : `${resource} was not found`);
  }
}

export class ValidationError extends DomainError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';
}

/**
 * A request that is well-formed but conflicts with the current state - for example a
 * salary change dated before the employee's most recent one.
 */
export class ConflictError extends DomainError {
  readonly statusCode = 409;
  readonly code = 'CONFLICT';
}

/** A rule the data model permits but the business does not. */
export class BusinessRuleError extends DomainError {
  readonly statusCode = 422;
  readonly code = 'BUSINESS_RULE_VIOLATION';
}
