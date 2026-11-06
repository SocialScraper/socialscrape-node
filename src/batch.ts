import { ENDPOINTS, type GetEndpointId } from "./generated/endpoints.js";
import type { BatchResult } from "./generated/types.js";
import type { ApiResponse, RequestOptions, Transport } from "./transport.js";

/** One item of a batch: a registry id (GET endpoints only) or a raw path. */
export type BatchRequest =
  | { endpoint: GetEndpointId; params?: Record<string, unknown> }
  | { path: string; params?: Record<string, unknown> };

export function batchToWire(requests: readonly BatchRequest[]): Array<{ path: string; params?: Record<string, unknown> }> {
  return requests.map((item, i) => {
    let path: string;
    if ("endpoint" in item) {
      const info = ENDPOINTS[item.endpoint];
      if (!info) throw new Error(`requests[${i}]: unknown endpoint id ${String(item.endpoint)}`);
      if (info.method !== "GET") throw new Error(`requests[${i}]: ${item.endpoint} is not a GET endpoint; batch runs GETs`);
      if (info.path.includes("{")) throw new Error(`requests[${i}]: ${item.endpoint} has a path parameter (${info.path}); batch cannot fill it, call it directly`);
      path = info.path;
    } else if ("path" in item && typeof item.path === "string") {
      path = item.path;
    } else {
      throw new Error(`requests[${i}] needs \`endpoint\` or \`path\``);
    }
    return item.params && Object.keys(item.params).length ? { path, params: { ...item.params } } : { path };
  });
}

/** `client.batch` */
export class BatchResource {
  constructor(private readonly t: Transport) {}

  /**
   * Run up to the account's batch limit of GET requests in one call. Each item
   * behaves exactly like the same call made alone (cache, charge, free
   * failures). `credits_charged` is the sum; each result's `response` is a
   * full envelope.
   */
  readonly run = (requests: readonly BatchRequest[], options?: RequestOptions): Promise<ApiResponse<BatchResult>> =>
    this.t.request<BatchResult>({ method: "POST", path: "/v1/batch", body: { requests: batchToWire(requests) } }, options);
}
