import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { ApiError } from '../lib/ApiError';

interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

function formatZodError(err: ZodError): string {
  return err.issues.map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`).join('; ');
}

/**
 * In Express 5, `req.query` (and `req.params`) are defined as getter-only
 * accessors, so a plain `req.query = ...` assignment throws
 * "Cannot set property query of #<IncomingMessage> which has only a getter".
 * Redefining the property is the supported way to swap in parsed values while
 * keeping `req.query` readable by downstream handlers.
 */
function replaceRequestProperty(req: Request, key: 'query' | 'params', value: unknown): void {
  Object.defineProperty(req, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Request validation architecture: pass zod schemas for body/query/params.
 * On success, req.body/query/params are replaced with the parsed (and
 * type-coerced) values. On failure, forwards a 400 ApiError to the global
 * error handler — the route handler never runs.
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        // req.body is a plain writable property, so direct assignment is fine.
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        replaceRequestProperty(req, 'query', schemas.query.parse(req.query));
      }
      if (schemas.params) {
        replaceRequestProperty(req, 'params', schemas.params.parse(req.params));
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(ApiError.badRequest(formatZodError(err), err.issues));
        return;
      }
      next(err);
    }
  };
}
