import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../errors.js';

interface Bucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: { windowMs: number; max: number; message?: string }) {
  const buckets = new Map<string, Bucket>();

  const sweep = (now: number) => {
    if (buckets.size < 5000) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  };

  return function rateLimit(req: Request, _res: Response, next: NextFunction) {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    sweep(now);

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (bucket.count >= options.max) {
      next(new ApiError(429, options.message ?? 'Too many requests. Please try again later.'));
      return;
    }

    bucket.count += 1;
    next();
  };
}
