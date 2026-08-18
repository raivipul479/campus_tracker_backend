import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

/**
 * Prisma's "table does not exist" (P2021), for one specific table.
 *
 * Code and database migrations ship separately here — migrations are applied by
 * hand, deliberately, and not as part of a deploy — so a table introduced by an
 * unapplied migration can legitimately be missing for a while. Features built on
 * such a table degrade instead of taking their whole screen down with them.
 */
export function isMissingTable(error: unknown, table: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === 'P2021'
    && String((error.meta as { table?: unknown } | undefined)?.table ?? '').includes(table);
}

export const asyncHandler =
  (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

export function notFound(_req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, 'Route not found'));
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({
      error: {
        message: error.message,
        details: error.details
      }
    });
  }

  const mysqlError = error as { code?: string; sqlMessage?: string };
  if (mysqlError.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({
      error: {
        message: 'A record with the same unique value already exists',
        details: mysqlError.sqlMessage
      }
    });
  }

  if (mysqlError.code === 'ECONNREFUSED') {
    return res.status(503).json({
      error: {
        message: 'Database connection refused. Start MySQL and check DB_HOST, DB_PORT, DB_USER, and DB_PASSWORD.'
      }
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return res.status(409).json({
        error: {
          message: 'A record with the same unique value already exists',
          details: error.meta
        }
      });
    }
    if (error.code === 'P2025') {
      return res.status(404).json({
        error: {
          message: 'Record not found'
        }
      });
    }
  }

  console.error(error);
  return res.status(500).json({
    error: {
      message: 'Internal server error'
    }
  });
}
