import { AxiosInstance } from "axios";

// Retry ladder — 2 retries so worst-case latency (per-request timeout × attempts
// + backoff) stays under typical MCP client call timeouts.
const RETRY_DELAYS_MS = [500, 1500];
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_RETRY_AFTER_MS = 10_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Response caps — one AIA list call must never hand the model a payload big
// enough to blow the context window. Applied here (the single chokepoint for
// every AIA tool) so the ceiling holds no matter what limit a tool passes.
const MAX_ROWS = 200;
const MAX_BYTES = 100_000;

// Retry transient failures: 429, 5xx gateway errors, and network/timeouts
// (no HTTP response at all — e.g. ECONNABORTED).
function isRetryable(error: any): boolean {
  const status = error?.response?.status;
  if (status === 429 || RETRYABLE_STATUS.has(status)) return true;
  return !error?.response; // network error / timeout
}

// Honor Retry-After (seconds or HTTP-date) when present, capped; else the ladder.
function retryDelayMs(error: any, attempt: number): number {
  const header = error?.response?.headers?.["retry-after"];
  if (header !== undefined) {
    const secs = Number(header);
    const ms = Number.isFinite(secs)
      ? secs * 1000
      : Date.parse(header) - Date.now();
    if (Number.isFinite(ms) && ms >= 0) return Math.min(ms, MAX_RETRY_AFTER_MS);
  }
  return RETRY_DELAYS_MS[attempt];
}

// Cap an array payload: slice to the row/byte ceiling and flag truncation so the
// model pages deliberately (cursor) rather than being handed everything at once.
function capPayload(data: any, meta?: any): any {
  if (!Array.isArray(data)) return meta !== undefined ? { data, meta } : data;
  let rows = data;
  let truncated = false;
  if (rows.length > MAX_ROWS) {
    rows = rows.slice(0, MAX_ROWS);
    truncated = true;
  }
  while (rows.length > 1 && JSON.stringify(rows).length > MAX_BYTES) {
    rows = rows.slice(0, Math.ceil(rows.length / 2));
    truncated = true;
  }
  const out: any = { data: rows, returned: rows.length };
  if (meta !== undefined) out.meta = meta;
  if (truncated) {
    out.truncated = true;
    out.truncation_note =
      "Response capped to protect context. Narrow filters or page with cursor for more.";
  }
  return out;
}

// AIA error convention: { error: { code, message } }. Surface it verbatim and
// never leak the API key — the key lives only on the axios instance headers,
// which we never read back or serialize here.
function aiaError(body: any): Error | null {
  if (body && typeof body === "object" && body.error) {
    const { code, message } = body.error;
    return new Error(
      [code, message].filter(Boolean).join(" — ") || "AIA request failed"
    );
  }
  return null;
}

/**
 * Single entry point for every AIA Public API call (spec §2). Attaches nothing
 * beyond the axios instance's baseURL + x-api-key header, parses JSON, and:
 *  - throws AIA's own `error.code — error.message` verbatim when the body carries
 *    an error (never the key, never an axios stack);
 *  - retries transient failures (429, 502/503/504, network/timeout) with backoff,
 *    honoring `Retry-After` when present;
 *  - returns `data` (plus `meta` when paginated), capping oversized array
 *    payloads with a `truncated` flag so one call can't blow the context window.
 */
export async function aiaGet(
  axiosInstance: AxiosInstance,
  path: string,
  params?: Record<string, any>
): Promise<any> {
  // Drop empty params so we never send blank filters to the API.
  const cleanParams: Record<string, any> = {};
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        cleanParams[key] = value;
      }
    }
  }

  let attempt = 0;
  // Infinite loop: each pass returns (success), throws (non-retryable or ladder
  // exhausted), or sleeps + retries. No path falls out, so there is no dead
  // post-loop throw.
  for (;;) {
    try {
      const response = await axiosInstance.get(path, { params: cleanParams });
      const body = response.data;
      const err = aiaError(body);
      if (err) throw err;
      if (body && typeof body === "object" && body.meta) {
        return capPayload(body.data, body.meta);
      }
      return capPayload(
        body && typeof body === "object" && "data" in body ? body.data : body
      );
    } catch (error: any) {
      if (isRetryable(error) && attempt < RETRY_DELAYS_MS.length) {
        await sleep(retryDelayMs(error, attempt));
        attempt++;
        continue;
      }
      // Prefer AIA's structured error over the raw axios message.
      const structured = aiaError(error.response?.data);
      throw structured ?? error;
    }
  }
}
