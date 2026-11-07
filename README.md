# socialscrape (TypeScript)

Social media data as an API: profiles, posts, comments, search, ads and
transcripts across platforms, in one response shape. This is the official
TypeScript / JavaScript client for the [SocialScrape API](https://socialscrape.dev/docs?utm_source=github&utm_medium=repo&utm_campaign=socialscrape).

- Zero runtime dependencies (uses `fetch`). Node 18+, Bun, Deno and server-side edge runtimes. TypeScript 5.4+ for the types.
- Server-side only: your API key is a secret. Never put it in code that ships to a browser or a mobile app; call the API from your backend.
- ESM and CommonJS builds, full types for every method, parameter and response.
- Typed errors per error code, retries with backoff and `Retry-After`, timeouts.
- `credits_charged` and `credits_remaining` on every response.
- Cursor auto-pagination, long-job polling, batch calls.

```sh
npm install socialscrape
```

## Quickstart

Create a key in the dashboard, then either export it or pass it in:

```sh
export SOCIALSCRAPE_API_KEY=ss_live_...
```

```ts
import { SocialScrape } from "socialscrape";

const client = new SocialScrape(); // reads SOCIALSCRAPE_API_KEY

const res = await client.tiktok.profile({ handle: "khaby.lame" });

console.log(res.data.followers);       // the normalised profile
console.log(res.credits_charged);      // 1
console.log(res.credits_remaining);    // what is left
```

Methods are grouped by platform and named after the endpoint:
`client.tiktok.profile()`, `client.tiktok.profileVideos()`,
`client.instagram.postComments()`, `client.youtube.videoTranscript()`,
`client.appleMusic.artist()`. Cross-platform helpers sit at the top:
`client.transcript({ url })` takes a link from any supported platform.

Parameters use the API's own names (`handle`, `url`, `id`, `query`, `cursor`,
`limit`, `sort`, `region`, `trim`, `raw`, `max_age_days`), so the REST docs and
the types always agree. Required ones are enforced by the compiler; endpoints
that take "one of `handle` or `url`" require at least one.

## The response

Every method resolves to the API envelope, typed, plus an `http` block:

```ts
res.ok                // true
res.data              // the endpoint's model (Profile, Post, ListPage<Post>, ...)
res.credits_charged   // 0 on a cache hit
res.credits_remaining // the team's balance after this call, or null
res.cached            // served from cache?
res.cached_at
res.request_id        // quote it to support
res.cursor            // lists: copies of data.cursor / data.has_more
res.has_more
res.raw               // only with { raw: true }: the platform's original object
res.http.rateLimit    // { limit: null, remaining: null }: the api sends no x-ratelimit-* headers
res.http.ignoredParams, res.http.attempts, res.http.headers
```

The client also keeps count: `client.creditsRemaining` (the last balance it saw)
and `client.creditsChargedTotal` (credits spent through this instance).

Useful parameters on every endpoint: `trim: true` (smaller response),
`raw: true` (adds the platform's original object), `max_age_days: 7` (accept a
cached result up to 7 days old for 0 credits).

## Errors

Failures are free (`creditsCharged` is 0) and throw a class per error code. Branch
on the class or on `code`, never on `message`.

```ts
import { SocialScrape, NotFoundError, RateLimitedError, InsufficientCreditsError, APIError } from "socialscrape";

try {
  await client.tiktok.profile({ handle: "no-such-account-123" });
} catch (e) {
  if (e instanceof NotFoundError) {
    // e.code === "not_found", e.status === 404, e.requestId, e.retryable === false
  } else if (e instanceof InsufficientCreditsError) {
    // top up
  } else if (e instanceof APIError) {
    console.error(e.code, e.retryable, e.requestId);
  } else {
    throw e;
  }
}
```

| Class | `code` | HTTP | Retryable |
|---|---|---|---|
| `InvalidParamsError` | `invalid_params` | 400 | no |
| `UnsupportedUrlError` | `unsupported_url` | 400 | no |
| `UnauthorizedError` | `unauthorized` | 401 | no |
| `InsufficientCreditsError` | `insufficient_credits` | 402 | no |
| `ForbiddenError` | `forbidden` | 403 | no |
| `PrivateError` | `private` | 403 | no |
| `AgeRestrictedError` | `age_restricted` | 403 | no |
| `NotFoundError` | `not_found` | 404 | no |
| `TranscriptUnavailableError` | `transcript_unavailable` | 404 | no |
| `ConflictError` | `conflict` | 409 | no |
| `RemovedError` | `removed` | 410 | no |
| `UnavailableInRegionError` | `unavailable_in_region` | 451 | no |
| `RateLimitedError` | `rate_limited` | 429 | yes |
| `UpstreamRateLimitedError` | `upstream_rate_limited` | 503 | yes |
| `UpstreamBlockedError` | `upstream_blocked` | 503 | yes |
| `OverloadedError` | `overloaded` | 503 | yes |
| `UpstreamErrorError` | `upstream_error` | 502 | yes |
| `UpstreamChangedError` | `upstream_changed` | 502 | no |
| `UpstreamTimeoutError` | `upstream_timeout` | 504 | yes |
| `InternalError` | `internal` | 500 | yes |
| `NotImplementedYetError` | `not_implemented` | 501 | no |

All extend `APIError` (fields: `code`, `message`, `retryable`, `status`,
`requestId`, `retryAfterSeconds`, `headers`, `body`). A code the client does not
know yet still arrives as a plain `APIError`. Beyond the API:
`SocialScrapeConnectionError`, `SocialScrapeTimeoutError` (and its subclass
`JobTimeoutError`), `UnexpectedResponseError` and `MissingApiKeyError`, all
extending `SocialScrapeError`.

## Retries, timeouts, idempotency

Retryable errors (the table above, network failures and client timeouts) are
retried up to `maxRetries` times (default 2) with exponential backoff and jitter.
`Retry-After` is honoured; one longer than `maxRetryAfterMs` (60 s) is not waited
for and the error is thrown. POST and DELETE calls carry an `Idempotency-Key`
(generated, and reused across retries) so a retried write never charges twice.

```ts
const client = new SocialScrape({
  apiKey: "ss_live_...",       // default: SOCIALSCRAPE_API_KEY
  baseUrl: "https://api.socialscrape.dev", // default: SOCIALSCRAPE_BASE_URL, else this
  timeoutMs: 60_000,           // per attempt
  maxRetries: 2,
  retryInitialDelayMs: 500,
  retryMaxDelayMs: 8_000,
  maxRetryAfterMs: 60_000,
  waitForJobs: true,
  jobTimeoutMs: 600_000,
  fetch: myFetch,              // optional: your own fetch
});

// Per call:
await client.tiktok.profile({ handle: "khaby.lame" }, { timeoutMs: 10_000, maxRetries: 0, signal: ctrl.signal });
```

## Pagination

List endpoints return `cursor` and `has_more`. Pass the cursor back, or let the
client walk it. **Every page is a request and costs what one call costs**, so cap
the walk with `maxItems` or `maxPages`.

```ts
for await (const video of client.paginate(client.tiktok.profileVideos, { handle: "khaby.lame" }, { maxItems: 100 })) {
  console.log(video.id, video.stats?.views);
}

// whole pages, with each page's credits and cursor
for await (const page of client.paginatePages(client.tiktok.profileVideos, { handle: "khaby.lame" }, { maxPages: 3 })) {
  console.log(page.data.items.length, page.credits_charged, page.cursor);
}
```

Iteration stops at `has_more: false`, at a repeated cursor, and at your caps; it
never fetches a page it does not need to reach `maxItems`.

## Long jobs (AI transcription, deep listings)

When an answer is not ready within a few seconds the API replies `202` with a job
id. The client follows it for you (polling is free; the finished job is charged
once) and resolves with the final response. Switch it off per call or globally:

```ts
const pending = await client.youtube.videoTranscript({ url }, { waitForJob: false });
// pending.http.status === 202, pending.data.job_id
const done = await client.waitForJob(pending.data.job_id);
```

A job that outlives `jobTimeoutMs` throws `JobTimeoutError` with its `jobId`; it
keeps running and can be fetched later with `client.jobs.get({ job_id })`.

## Batch and monitors

```ts
const res = await client.batch.run([
  { endpoint: "tiktok.profile", params: { handle: "khaby.lame" } },
  { endpoint: "tiktok.profile", params: { handle: "charlidamelio" } },
]);
res.credits_charged;                 // the sum of the items
res.data.results[0].response.data;   // each item is a full envelope

const monitor = await client.monitors.create({
  endpoint: "/v1/tiktok/profile/videos",
  params: { handle: "khaby.lame" },
  webhook_url: "https://example.com/hooks/socialscrape",
});
```

## Account

```ts
const { data } = await client.account.credits();   // free
for await (const row of client.paginate(client.account.usage, {})) { /* request history */ }
```

## Newer endpoints

Methods are generated from the API's endpoint registry, and only endpoints that
are built appear (coming-soon ones are hidden). To call a path this client
version does not know yet:

```ts
const res = await client.request("GET", "/v1/some/new/endpoint", { query: { handle: "x" } });
```

`ENDPOINTS` lists every endpoint the installed version knows, with its path,
method, credit rule and whether it paginates.

## Development

The code under `src/generated/` is produced from the API registry. From the
SocialScrape repository root:

```sh
.venv/bin/python sdks/python/tools/generate.py    # regenerate both SDKs
cd sdks/typescript
npm install
npm run check                                     # typecheck, build, test
```

Tests run against a mocked `fetch`; one of them calls every generated method and
checks it hits the registry's path, method and parameters. The Python SDK's tests
run the same surface against the real API routes.
