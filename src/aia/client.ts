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
  // AIA's structured { error } arrives on an HTTP 200, so it has no `.response`
  // — but it's a deterministic caller error that will never succeed on retry.
  // Tagged by aiaError(); never retry it (would otherwise look like a network error).
  if (error?.isAiaError) return false;
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

const jsonLen = (v: any): number => {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return 0;
  }
};

const CAP_NOTE =
  "Response capped to protect context. Narrow filters or page with cursor for more.";
const ELIDE_NOTE =
  "Payload capped to protect context; largest sections elided — fetch them individually via aia_get_institution_section.";

// Elide the largest top-level values of an object until it fits under MAX_BYTES,
// keeping the small fields (e.g. a bundle's profile) intact. Returns the capped
// object plus the names of the elided keys.
function elideObject(obj: Record<string, any>): {
  value: Record<string, any>;
  elided: string[];
} {
  const value: Record<string, any> = { ...obj };
  const elided: string[] = [];
  const ranked = Object.keys(value)
    .map((k) => ({ k, size: jsonLen(value[k]) }))
    .sort((a, b) => b.size - a.size);
  for (const { k, size } of ranked) {
    if (jsonLen(value) <= MAX_BYTES) break;
    value[k] = { elided: true, approx_bytes: size };
    elided.push(k);
  }
  return { value, elided };
}

// Cap any payload so one call can't blow the context window:
//  - array: slice to the row/byte ceiling; a lone oversized row is elided in place.
//  - object: byte-cap by eliding the largest top-level sub-payloads (the bundle
//    endpoint returns an object, so it would otherwise bypass the cap entirely).
// Truncation is always flagged so the model pages/fetches deliberately.
function capPayload(data: any, meta?: any): any {
  const wrap = (value: any, extra?: Record<string, any>) => {
    const out: any = { data: value, ...extra };
    if (meta !== undefined) out.meta = meta;
    return out;
  };

  if (Array.isArray(data)) {
    let rows = data;
    let truncated = rows.length > MAX_ROWS;
    if (truncated) rows = rows.slice(0, MAX_ROWS);
    while (rows.length > 1 && jsonLen(rows) > MAX_BYTES) {
      rows = rows.slice(0, Math.ceil(rows.length / 2));
      truncated = true;
    }
    // A single row can still exceed the byte ceiling; elide within it so the
    // model gets a bounded, flagged response rather than silently huge output.
    let elided: string[] | undefined;
    if (
      rows.length === 1 &&
      rows[0] &&
      typeof rows[0] === "object" &&
      jsonLen(rows) > MAX_BYTES
    ) {
      const capped = elideObject(rows[0]);
      rows = [capped.value];
      elided = capped.elided;
      truncated = true;
    }
    if (!truncated) return wrap(rows, { returned: rows.length });
    return wrap(rows, {
      returned: rows.length,
      truncated: true,
      truncation_note: elided ? ELIDE_NOTE : CAP_NOTE,
      ...(elided ? { elided } : {}),
    });
  }

  if (data && typeof data === "object" && jsonLen(data) > MAX_BYTES) {
    const { value, elided } = elideObject(data);
    const extra = { truncated: true, elided, truncation_note: ELIDE_NOTE };
    return meta !== undefined
      ? { data: value, meta, ...extra }
      : { ...value, ...extra };
  }

  return meta !== undefined ? { data, meta } : data;
}

// AIA error convention: { error: { code, message } }. Surface it verbatim and
// never leak the API key — the key lives only on the axios instance headers,
// which we never read back or serialize here.
function aiaError(body: any): Error | null {
  if (body && typeof body === "object" && body.error) {
    const { code, message } = body.error;
    const err: any = new Error(
      [code, message].filter(Boolean).join(" — ") || "AIA request failed"
    );
    err.isAiaError = true; // deterministic API error — non-retryable (see isRetryable)
    return err;
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
