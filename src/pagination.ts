import type { ListPage } from "./generated/types.js";
import type { ApiResponse, RequestOptions } from "./transport.js";

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Any generated list method. */
export type ListMethod<P, T> = (params: P, options?: RequestOptions) => Promise<ApiResponse<ListPage<T>>>;

export interface PaginateOptions {
  /** Stop after this many items (the last page is not over-fetched). */
  maxItems?: number;
  /** Stop after this many requests. */
  maxPages?: number;
  /** Passed to every underlying call. */
  requestOptions?: RequestOptions;
}

function nextCursor(r: ApiResponse<ListPage<unknown>>, current: string | undefined): string | undefined {
  const hasMore = r.has_more ?? r.data.has_more;
  const next = r.cursor ?? r.data.cursor;
  if (!hasMore || !next || next === current) return undefined;
  return next;
}

/** Walk a list method page by page, following `cursor`. Each page is a request and costs what one call costs. */
export async function* paginatePages<P extends { cursor?: string }, T>(
  fn: ListMethod<P, T>,
  params: DistributiveOmit<P, "cursor"> & { cursor?: string },
  options: PaginateOptions = {},
): AsyncGenerator<ApiResponse<ListPage<T>>, void, undefined> {
  let cursor = (params as { cursor?: string }).cursor;
  const seen = new Set<string>();
  let pages = 0;
  for (;;) {
    const page = await fn({ ...params, ...(cursor ? { cursor } : {}) } as unknown as P, options.requestOptions);
    pages += 1;
    yield page;
    const next = nextCursor(page, cursor);
    if (next === undefined || seen.has(next) || (options.maxPages !== undefined && pages >= options.maxPages)) return;
    seen.add(next);
    cursor = next;
  }
}

/** Walk a list method and yield its items. */
export async function* paginate<P extends { cursor?: string }, T>(
  fn: ListMethod<P, T>,
  params: DistributiveOmit<P, "cursor"> & { cursor?: string },
  options: PaginateOptions = {},
): AsyncGenerator<T, void, undefined> {
  if (options.maxItems !== undefined && options.maxItems <= 0) return;
  let count = 0;
  for await (const page of paginatePages(fn, params, options)) {
    for (const item of page.data.items) {
      yield item;
      count += 1;
      if (options.maxItems !== undefined && count >= options.maxItems) return;
    }
  }
}
