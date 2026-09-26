import { ApiError } from './errors.js';

export const MAX_PAGE_SIZE = 200;

export type PageRequest = { limit: number; offset: number };

/**
 * Reads `limit` and `offset` for a scroll-to-load list. Returns null when no
 * limit is given, meaning "everything", which is what callers that predate
 * paging (and exports) ask for.
 */
export function parsePage(query: { limit?: unknown; offset?: unknown }): PageRequest | null {
  if (query.limit === undefined || query.limit === '') return null;
  const limit = Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new ApiError(400, `limit must be an integer from 1 to ${MAX_PAGE_SIZE}`);
  }
  const offset = query.offset === undefined || query.offset === '' ? 0 : Number(query.offset);
  if (!Number.isInteger(offset) || offset < 0) throw new ApiError(400, 'offset must be a non-negative integer');
  return { limit, offset };
}

/** The paging fields of a response: where this page starts and where the next one does. */
export function pageInfo(page: PageRequest, returned: number, total: number) {
  return {
    total,
    offset: page.offset,
    limit: page.limit,
    nextOffset: page.offset + returned < total ? page.offset + returned : null
  };
}
