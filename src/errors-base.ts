/** Error base classes. The per-code subclasses are generated (`generated/errors.ts`). */

/** Base class of everything this package throws. */
export class SocialScrapeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "SocialScrapeError";
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** No API key was passed and SOCIALSCRAPE_API_KEY is not set. */
export class MissingApiKeyError extends SocialScrapeError {
  constructor() {
    super("No API key: pass { apiKey } or set SOCIALSCRAPE_API_KEY.");
    this.name = "MissingApiKeyError";
  }
}

export interface APIErrorInit {
  code?: string;
  message: string;
  retryable: boolean;
  status?: number;
  requestId?: string;
  retryAfterSeconds?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * The API answered with an error (an error envelope, or an HTTP error from a
 * gateway). Branch on `code`, never on `message`. Every failure is free, so
 * `creditsCharged` is always 0. `retryable` says whether the same request may
 * succeed later; the client has already retried when it was set and the retry
 * budget allowed.
 */
export class APIError extends SocialScrapeError {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly creditsCharged = 0;

  constructor(init: APIErrorInit) {
    const suffix = [init.status ? `HTTP ${init.status}` : "", init.requestId ? `request ${init.requestId}` : ""]
      .filter(Boolean)
      .join(", ");
    super(`${init.code ?? "internal"}: ${init.message}${suffix ? ` (${suffix})` : ""}`);
    this.name = "APIError";
    this.code = init.code ?? "internal";
    this.retryable = init.retryable;
    this.status = init.status;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.headers = init.headers ?? {};
    this.body = init.body;
  }
}

/** The server answered something that is not a SocialScrape envelope. */
export class UnexpectedResponseError extends SocialScrapeError {
  readonly retryable = false;
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "UnexpectedResponseError";
    this.status = status;
    this.body = body;
  }
}

/** The request never got an answer (DNS, refused, reset). Retryable. */
export class SocialScrapeConnectionError extends SocialScrapeError {
  readonly retryable = true;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SocialScrapeConnectionError";
  }
}

/** The request timed out on the client side. Retryable. */
export class SocialScrapeTimeoutError extends SocialScrapeError {
  readonly retryable: boolean = true;
  constructor(message: string) {
    super(message);
    this.name = "SocialScrapeTimeoutError";
  }
}

/** A long job did not finish inside `jobTimeoutMs`. It keeps running: fetch it later with `client.jobs.get`. */
export class JobTimeoutError extends SocialScrapeTimeoutError {
  readonly jobId: string;
  constructor(message: string, jobId: string) {
    super(message);
    this.name = "JobTimeoutError";
    this.jobId = jobId;
  }
}
