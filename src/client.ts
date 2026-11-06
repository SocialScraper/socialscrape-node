import { GeneratedResources } from "./generated/resources.js";
import type { ListPage } from "./generated/types.js";
import {
  paginate,
  paginatePages,
  type DistributiveOmit,
  type ListMethod,
  type PaginateOptions,
} from "./pagination.js";
import { HttpTransport, type ApiResponse, type ClientOptions, type RequestOptions } from "./transport.js";

/**
 * The SocialScrape client.
 *
 * ```ts
 * const client = new SocialScrape(); // key from SOCIALSCRAPE_API_KEY
 * const res = await client.bluesky.profile({ handle: "bsky.app" });
 * console.log(res.data.followers, res.credits_charged, res.credits_remaining);
 * ```
 */
export class SocialScrape extends GeneratedResources {
  private readonly http: HttpTransport;

  constructor(options: ClientOptions = {}) {
    const http = new HttpTransport(options);
    super(http);
    this.http = http;
  }

  /** The balance after the most recent answer that reported one. */
  get creditsRemaining(): number | null {
    return this.http.creditsRemaining;
  }

  /** Credits charged by this client instance since it was created. */
  get creditsChargedTotal(): number {
    return this.http.creditsChargedTotal;
  }

  /**
   * Iterate the items of a list method across pages, following `cursor`.
   * Every page is a request: cap the walk with `maxItems` or `maxPages`.
   *
   * ```ts
   * for await (const post of client.paginate(client.bluesky.profilePosts, { handle: "bsky.app" }, { maxItems: 100 })) { ... }
   * ```
   */
  paginate<P extends { cursor?: string }, T>(
    fn: ListMethod<P, T>,
    params: NoInfer<DistributiveOmit<P, "cursor"> & { cursor?: string }>,
    options?: PaginateOptions,
  ): AsyncGenerator<T, void, undefined> {
    return paginate(fn, params, options);
  }

  /** Like `paginate`, but yields whole pages (each with its own credits and cursor). */
  paginatePages<P extends { cursor?: string }, T>(
    fn: ListMethod<P, T>,
    params: NoInfer<DistributiveOmit<P, "cursor"> & { cursor?: string }>,
    options?: PaginateOptions,
  ): AsyncGenerator<ApiResponse<ListPage<T>>, void, undefined> {
    return paginatePages(fn, params, options);
  }

  /** Poll a job (free) until it finishes and return its final answer. */
  waitForJob<T = unknown>(jobId: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.http.waitForJob<T>(jobId, options);
  }

  /** Call any path directly, e.g. an endpoint newer than this client. */
  request<T = unknown>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    init: { query?: Record<string, unknown>; body?: Record<string, unknown> } = {},
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    return this.http.request<T>({ method, path, ...init }, options);
  }
}
