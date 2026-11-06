export { SocialScrape, SocialScrape as default } from "./client.js";
export { BatchResource, type BatchRequest } from "./batch.js";
export { paginate, paginatePages, type PaginateOptions, type ListMethod } from "./pagination.js";
export {
  DEFAULT_BASE_URL,
  type ApiResponse,
  type ClientOptions,
  type HttpInfo,
  type RequestOptions,
} from "./transport.js";
export {
  APIError,
  JobTimeoutError,
  MissingApiKeyError,
  SocialScrapeConnectionError,
  SocialScrapeError,
  SocialScrapeTimeoutError,
  UnexpectedResponseError,
  type APIErrorInit,
} from "./errors-base.js";
export * from "./generated/errors.js";
export { ENDPOINTS, type EndpointId, type EndpointInfo, type GetEndpointId } from "./generated/endpoints.js";
export type * from "./generated/types.js";
export { VERSION } from "./version.js";
