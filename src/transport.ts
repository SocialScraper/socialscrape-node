import {
  APIError,
  JobTimeoutError,
  MissingApiKeyError,
  SocialScrapeConnectionError,
  SocialScrapeError,
  SocialScrapeTimeoutError,
  UnexpectedResponseError,
  type APIErrorInit,
} from "./errors-base.js";
import { ERROR_CLASSES, ERROR_INFO } from "./generated/errors.js";
import type { ErrorCode } from "./generated/types.js";
import { VERSION } from "./version.js";

declare const process: { env?: Record<string, string | undefined> } | undefined;

export const DEFAULT_BASE_URL = "https://api.socialscrape.dev";

/** Transport facts about an answer; the envelope fields live on the response itself. */
export interface HttpInfo {
  status: number;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  requestId: string | null;
  /** x-ratelimit-limit / x-ratelimit-remaining. The api no longer sends them, so both are null. */
  rateLimit: { limit: number | null; remaining: number | null };
  /** x-ignored-params: parameter names the API did not recognise. */
  ignoredParams: string[];
  /** x-idempotent-replay: this is the first answer, replayed. */
  idempotentReplay: boolean;
  /** HTTP attempts made, retries included. */
  attempts: number;
}

/** A successful answer: the envelope, typed, plus `http`. */
export interface ApiResponse<T> {
  ok: true;
  /** Credits this call cost. 0 on a cache hit, a failure or a free endpoint. */
  credits_charged: number;
  /** The team's balance after this call, when the API knows it. */
  credits_remaining: number | null;
  cached: boolean;
  cached_at: string | null;
  request_id: string;
  data: T;
  /** Copies of data.cursor / data.has_more for list endpoints. */
  cursor?: string | null;
  has_more?: boolean | null;
  /** The platform's original object; only with `raw: true`. */
  raw?: unknown;
  http: HttpInfo;
}

/** Per-call overrides. Anything left out uses the client's setting. */
export interface RequestOptions {
  /** Milliseconds, per attempt. */
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** POST and DELETE get a random one automatically (and it is reused across retries). */
  idempotencyKey?: string;
  /** Follow a 202 job to its result (default true). */
  waitForJob?: boolean;
  jobTimeoutMs?: number;
}

export interface ClientOptions {
  /** Default: process.env.SOCIALSCRAPE_API_KEY. */
  apiKey?: string;
  /** Default: process.env.SOCIALSCRAPE_BASE_URL, else https://api.socialscrape.dev. */
  baseUrl?: string;
  /** Per attempt. Default 60000. */
  timeoutMs?: number;
  /** Retries after the first attempt, on retryable errors. Default 2. */
  maxRetries?: number;
  retryInitialDelayMs?: number;
  retryMaxDelayMs?: number;
  /** A Retry-After longer than this is not waited for; the error is thrown. Default 60000. */
  maxRetryAfterMs?: number;
  headers?: Record<string, string>;
  /** Follow 202 jobs to their result. Default true. */
  waitForJobs?: boolean;
  jobTimeoutMs?: number;
  jobPollIntervalMs?: number;
  /** Your own fetch (a mock, a proxy-aware one). Default: the global. */
  fetch?: typeof fetch;
  /** Test hook: replaces the real sleep between retries and job polls. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestSpec {
  method: "GET" | "POST" | "DELETE";
  path: string;
  pathParams?: Record<string, string | number | boolean>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  /** Used by jobs.get, which is how you poll. */
  noJobWait?: boolean;
}

/** What the generated resources need from the client. */
export interface Transport {
  request<T>(spec: RequestSpec, options?: RequestOptions): Promise<ApiResponse<T>>;
}

/** The entries of `params` named in `keys` that are not undefined. */
export function pick(params: object, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const src = params as Record<string, unknown>;
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

const STATUS_CODES: Record<number, ErrorCode> = {
  400: "invalid_params", 401: "unauthorized", 402: "insufficient_credits", 403: "forbidden", 404: "not_found",
  409: "conflict", 429: "rate_limited", 500: "internal", 501: "not_implemented", 502: "upstream_error",
  503: "overloaded", 504: "upstream_timeout",
};

function wireValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function parseRetryAfter(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, n);
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : Math.max(0, (t - Date.now()) / 1000);
}

function intOrNull(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

interface Prepared {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
  timeoutMs: number;
  maxRetries: number;
  signal: AbortSignal | undefined;
}

/** Turns an answer into a response, or returns the error to throw. */
export function interpret(
  status: number,
  headers: Record<string, string>,
  text: string,
  attempts: number,
): ApiResponse<unknown> | SocialScrapeError {
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  const env = (body && typeof body === "object" ? body : undefined) as Record<string, unknown> | undefined;
  const retryAfterSeconds = parseRetryAfter(headers["retry-after"]);
  if (env && env.ok === true && status < 400) {
    const requestId = (env.request_id as string | undefined) ?? headers["x-request-id"] ?? null;
    const res: ApiResponse<unknown> = {
      ok: true,
      credits_charged: Number(env.credits_charged ?? 0),
      credits_remaining: (env.credits_remaining as number | null | undefined) ?? null,
      cached: Boolean(env.cached),
      cached_at: (env.cached_at as string | null | undefined) ?? null,
      request_id: requestId ?? "",
      data: env.data,
      http: {
        status,
        headers,
        requestId,
        rateLimit: { limit: intOrNull(headers["x-ratelimit-limit"]), remaining: intOrNull(headers["x-ratelimit-remaining"]) },
        ignoredParams: (headers["x-ignored-params"] ?? "").split(",").filter(Boolean),
        idempotentReplay: headers["x-idempotent-replay"] === "true",
        attempts,
      },
    };
    if (env.cursor !== undefined) res.cursor = env.cursor as string | null;
    if (env.has_more !== undefined) res.has_more = env.has_more as boolean | null;
    if ("raw" in env) res.raw = env.raw;
    return res;
  }
  const err = env && env.ok === false && env.error && typeof env.error === "object" ? (env.error as Record<string, unknown>) : undefined;
  if (err) {
    const code = String(err.code ?? "internal");
    const known = code in ERROR_CLASSES;
    const Cls = known ? ERROR_CLASSES[code as ErrorCode] : APIError;
    const retryable = typeof err.retryable === "boolean" ? err.retryable : known ? ERROR_INFO[code as ErrorCode].retryable : false;
    const init: APIErrorInit = { code, message: String(err.message ?? code), retryable, status, headers, body, retryAfterSeconds };
    const requestId = (env?.request_id as string | undefined) ?? headers["x-request-id"];
    if (requestId) init.requestId = requestId;
    return new Cls(init);
  }
  const mapped = STATUS_CODES[status];
  if (status >= 400 && mapped) {
    const init: APIErrorInit = {
      code: mapped,
      message: `HTTP ${status} without a SocialScrape error body`,
      retryable: ERROR_INFO[mapped].retryable,
      status,
      headers,
      body: text.slice(0, 500),
      retryAfterSeconds,
    };
    if (headers["x-request-id"]) init.requestId = headers["x-request-id"];
    return new ERROR_CLASSES[mapped](init);
  }
  return new UnexpectedResponseError(`unexpected HTTP ${status} response`, status, text.slice(0, 500));
}

function isJob(r: ApiResponse<unknown>): boolean {
  const d = r.data as { object?: string } | null | undefined;
  return r.http.status === 202 && !!d && typeof d === "object" && d.object === "job";
}

export class HttpTransport implements Transport {
  readonly apiKey: string;
  readonly baseUrl: string;
  private readonly o: Required<Omit<ClientOptions, "apiKey" | "baseUrl" | "fetch" | "headers" | "sleep">>;
  private readonly headers: Record<string, string>;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  creditsRemaining: number | null = null;
  creditsChargedTotal = 0;

  constructor(options: ClientOptions = {}) {
    const env = typeof process !== "undefined" ? process?.env : undefined;
    const key = options.apiKey ?? env?.SOCIALSCRAPE_API_KEY;
    if (!key) throw new MissingApiKeyError();
    this.apiKey = key;
    this.baseUrl = (options.baseUrl ?? env?.SOCIALSCRAPE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.o = {
      timeoutMs: options.timeoutMs ?? 60_000,
      maxRetries: options.maxRetries ?? 2,
      retryInitialDelayMs: options.retryInitialDelayMs ?? 500,
      retryMaxDelayMs: options.retryMaxDelayMs ?? 8_000,
      maxRetryAfterMs: options.maxRetryAfterMs ?? 60_000,
      waitForJobs: options.waitForJobs ?? true,
      jobTimeoutMs: options.jobTimeoutMs ?? 600_000,
      jobPollIntervalMs: options.jobPollIntervalMs ?? 1_000,
    };
    this.headers = options.headers ?? {};
    const f = options.fetch ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);
    if (!f) throw new SocialScrapeError("No fetch available: use Node 18+ or pass { fetch }.");
    this.fetchFn = f;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private prepare(spec: RequestSpec, options: RequestOptions | undefined): Prepared {
    let path = spec.path;
    for (const [k, v] of Object.entries(spec.pathParams ?? {})) path = path.replace(`{${k}}`, encodeURIComponent(String(v)));
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(spec.query ?? {})) if (v !== undefined && v !== null) qs.append(k, wireValue(v));
    const headers: Record<string, string> = {
      "x-api-key": this.apiKey,
      accept: "application/json",
      "x-socialscrape-sdk": `typescript/${VERSION}`,
    };
    // Header names are case-insensitive on the wire: merge in lower case so an override
    // such as "X-Api-Key" replaces ours instead of being joined to it.
    for (const src of [this.headers, options?.headers ?? {}]) {
      for (const [k, v] of Object.entries(src)) headers[k.toLowerCase()] = v;
    }
    let body: string | undefined;
    if (spec.body !== undefined) {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(spec.body)) if (v !== undefined && v !== null) clean[k] = v;
      body = JSON.stringify(clean);
      headers["content-type"] = "application/json";
    }
    if (spec.method === "POST" || spec.method === "DELETE") headers["idempotency-key"] = options?.idempotencyKey ?? randomId();
    else if (options?.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
    const q = qs.toString();
    return {
      method: spec.method,
      url: this.baseUrl + path + (q ? `?${q}` : ""),
      headers,
      body,
      timeoutMs: options?.timeoutMs ?? this.o.timeoutMs,
      maxRetries: options?.maxRetries ?? this.o.maxRetries,
      signal: options?.signal,
    };
  }

  private async send(prep: Prepared, attempt: number): Promise<ApiResponse<unknown>> {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, prep.timeoutMs);
    const onAbort = () => ctrl.abort();
    if (prep.signal) {
      if (prep.signal.aborted) ctrl.abort();
      else prep.signal.addEventListener("abort", onAbort, { once: true });
    }
    let status: number;
    let text: string;
    const headers: Record<string, string> = {};
    try {
      const init: RequestInit = { method: prep.method, headers: prep.headers, signal: ctrl.signal };
      if (prep.body !== undefined) init.body = prep.body;
      const res = await this.fetchFn(prep.url, init);
      status = res.status;
      res.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      text = await res.text();
    } catch (e) {
      if (timedOut) throw new SocialScrapeTimeoutError(`${prep.method} ${prep.url} timed out after ${prep.timeoutMs}ms`);
      if (prep.signal?.aborted) throw e; // the caller's own abort: not ours to retry or wrap
      throw new SocialScrapeConnectionError(`${prep.method} ${prep.url} failed: ${(e as Error)?.message ?? String(e)}`, { cause: e });
    } finally {
      clearTimeout(timer);
      prep.signal?.removeEventListener("abort", onAbort);
    }
    const result = interpret(status, headers, text, attempt);
    if (result instanceof SocialScrapeError) throw result;
    return result;
  }

  private retryDelayMs(attempt: number, err: unknown, maxRetries: number): number | null {
    const retryable = (err as { retryable?: boolean }).retryable === true;
    if (attempt > maxRetries || !retryable) return null;
    const after = (err as { retryAfterSeconds?: number }).retryAfterSeconds;
    if (after !== undefined) return after * 1000 <= this.o.maxRetryAfterMs ? after * 1000 : null;
    const base = Math.min(this.o.retryMaxDelayMs, this.o.retryInitialDelayMs * 2 ** (attempt - 1));
    return base * (0.5 + Math.random() / 2);
  }

  /** One call with retries; no job following, no stats. */
  private async execute(spec: RequestSpec, options: RequestOptions | undefined): Promise<ApiResponse<unknown>> {
    const prep = this.prepare(spec, options);
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        return await this.send(prep, attempt);
      } catch (e) {
        if (!(e instanceof SocialScrapeError)) throw e;
        const delay = this.retryDelayMs(attempt, e, prep.maxRetries);
        if (delay === null) throw e;
        await this.sleep(delay);
      }
    }
  }

  private record(resp: ApiResponse<unknown>): void {
    if (resp.credits_remaining !== null) this.creditsRemaining = resp.credits_remaining;
    this.creditsChargedTotal += resp.credits_charged;
  }

  async request<T>(spec: RequestSpec, options?: RequestOptions): Promise<ApiResponse<T>> {
    let resp = await this.execute(spec, options);
    const wait = options?.waitForJob ?? this.o.waitForJobs;
    if (!spec.noJobWait && wait && isJob(resp)) {
      resp = await this.pollJob((resp.data as { job_id: string }).job_id, options);
    }
    this.record(resp);
    return resp as ApiResponse<T>;
  }

  /** Poll a job (free) until it finishes and return its final answer. */
  async waitForJob<T = unknown>(jobId: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    const resp = await this.pollJob(jobId, options);
    this.record(resp);
    return resp as ApiResponse<T>;
  }

  private async pollJob(jobId: string, options: RequestOptions | undefined): Promise<ApiResponse<unknown>> {
    const limit = options?.jobTimeoutMs ?? this.o.jobTimeoutMs;
    const deadline = Date.now() + limit;
    let interval = this.o.jobPollIntervalMs;
    const pollOptions: RequestOptions = {};
    if (options?.timeoutMs !== undefined) pollOptions.timeoutMs = options.timeoutMs;
    if (options?.maxRetries !== undefined) pollOptions.maxRetries = options.maxRetries;
    if (options?.signal) pollOptions.signal = options.signal;
    if (options?.headers) pollOptions.headers = options.headers;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new JobTimeoutError(`job ${jobId} did not finish within ${limit}ms; it keeps running`, jobId);
      await this.sleep(Math.min(interval, remaining));
      interval = Math.min(interval * 1.5, Math.max(this.o.jobPollIntervalMs, 5_000));
      const r = await this.execute({ method: "GET", path: "/v1/jobs/{job_id}", pathParams: { job_id: jobId } }, pollOptions);
      if (!isJob(r)) return r;
    }
  }
}
