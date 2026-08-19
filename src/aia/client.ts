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
// Shrink to below this internal target, not MAX_BYTES, so there's headroom for the
// response wrapper (truncation_note + elided list + meta). Without the reserve, the
// wrapper can push an elided bundle back over the ceiling and trip the backstop,
// withholding it wholesale — losing even the profile the eliding meant to keep.
const SHRINK_TARGET = MAX_BYTES - 8_000;
// Cap how many elided key names we echo, so the `elided` list can't itself become
// the thing that blows the wrapper past MAX_BYTES on a very wide object.
const MAX_ELIDED_NAMES = 100;

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

// Measure with 2-space indent to match how server.ts serializes tool results
// (JSON.stringify(result, null, 2)) — that pretty-printed string is what actually
// reaches the model, and it's ~2–3× larger than compact for number/array-heavy
// payloads. Measuring compact here would under-count and let the real output blow
// past MAX_BYTES.
const jsonLen = (v: any): number => {
  try {
    return JSON.stringify(v, null, 2)?.length ?? 0;
  } catch {
    return 0;
  }
};

const CAP_NOTE =
  "Response capped to protect context. Narrow filters or page with cursor for more.";
const ELIDE_NOTE =
  "Payload capped to protect context; largest sections elided — fetch them individually via aia_get_institution_section.";

const TOO_LARGE_NOTE =
  "Response exceeded the size cap and was withheld — narrow filters, page with cursor, or fetch individual slices via aia_get_institution_section.";

// Last-resort marker when a payload can't be brought under the ceiling by
// slicing/eliding. Guarantees capPayload never returns something oversized.
function tooLargeMarker(bytes: number, meta?: any): any {
  const out: any = {
    data: null,
    truncated: true,
    truncation_note: TOO_LARGE_NOTE,
    approx_bytes: bytes,
  };
  // Keep meta (pagination cursors) only if it fits — a pathologically large meta
  // must not push the withhold-marker itself back over the ceiling.
  if (meta !== undefined) {
    out.meta = meta;
    if (jsonLen(out) > MAX_BYTES) {
      delete out.meta;
      out.meta_omitted = true;
    }
  }
  return out;
}

// Elide the largest top-level values of a (plain, non-array) object until it fits
// under `target`, keeping the small fields (e.g. a bundle's profile) intact. Only
// elides a value when the stub is actually smaller than it — otherwise the
// replacement would inflate the payload rather than shrink it.
function elideObject(
  obj: Record<string, any>,
  target: number
): {
  value: Record<string, any>;
  elided: string[];
} {
  const value: Record<string, any> = { ...obj };
  const elided: string[] = [];
  const ranked = Object.keys(value)
    .map((k) => ({ k, size: jsonLen(value[k]) }))
    .sort((a, b) => b.size - a.size);
  // Running count instead of re-serializing the whole object each iteration (that
  // was O(n²) on objects with many keys). The per-elision delta is close to
  // stub−size but not exact under indentation — a nested value carries extra
  // per-line indent the standalone measure omits — so `total` reads slightly
  // optimistic. That's why we aim at `target` (< MAX_BYTES) and let the backstop
  // in capPayload enforce the hard ceiling.
  let total = jsonLen(value);
  for (const { k, size } of ranked) {
    if (total <= target) break;
    const stubSize = jsonLen({ elided: true, approx_bytes: size });
    // ranked is descending: once a value is too small for the stub to shrink,
    // every remaining value is too — stop rather than scanning them all.
    if (size <= stubSize) break;
    value[k] = { elided: true, approx_bytes: size };
    elided.push(k);
    total -= size - stubSize;
  }
  return { value, elided };
}

// Response fields describing an elision, with the name list bounded so it can't
// itself bloat the wrapper past the cap.
function elidedFields(elided: string[]): Record<string, any> {
  if (elided.length === 0) return {};
  return {
    elided: elided.slice(0, MAX_ELIDED_NAMES),
    elided_count: elided.length,
  };
}

// Cap any payload so one call can't blow the context window:
//  - array: slice to the row/byte ceiling; a lone oversized plain-object row is
//    elided in place.
//  - object: byte-cap by eliding the largest top-level sub-payloads (the bundle
//    endpoint returns an object, so it would otherwise bypass the cap entirely).
//  - anything still over the ceiling (arrays-as-rows, lone huge primitives,
//    objects of many tiny keys) hits the backstop and is withheld wholesale.
// The result is GUARANTEED to serialize under MAX_BYTES; truncation is flagged.
function capPayload(data: any, meta?: any): any {
  const wrap = (value: any, extra?: Record<string, any>) => {
    const out: any = { data: value, ...extra };
    if (meta !== undefined) out.meta = meta;
    return out;
  };

  let result: any;
  if (Array.isArray(data)) {
    let rows = data;
    let truncated = rows.length > MAX_ROWS;
    if (truncated) rows = rows.slice(0, MAX_ROWS);
    // Over the ceiling → halve down to the target (with wrapper headroom).
    if (jsonLen(rows) > MAX_BYTES) {
      while (rows.length > 1 && jsonLen(rows) > SHRINK_TARGET) {
        rows = rows.slice(0, Math.ceil(rows.length / 2));
      }
      truncated = true;
    }
    // A lone plain-object row can still exceed the ceiling; elide within it.
    // Array-valued or primitive lone rows are left for the backstop below.
    let elided: string[] | undefined;
    if (
      rows.length === 1 &&
      rows[0] &&
      typeof rows[0] === "object" &&
      !Array.isArray(rows[0]) &&
      jsonLen(rows) > MAX_BYTES
    ) {
      const capped = elideObject(rows[0], SHRINK_TARGET);
      rows = [capped.value];
      elided = capped.elided;
      truncated = true;
    }
    result = truncated
      ? wrap(rows, {
          returned: rows.length,
          truncated: true,
          truncation_note: elided ? ELIDE_NOTE : CAP_NOTE,
          ...(elided ? elidedFields(elided) : {}),
        })
      : wrap(rows, { returned: rows.length });
  } else if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    jsonLen(data) > MAX_BYTES
  ) {
    const { value, elided } = elideObject(data, SHRINK_TARGET);
    const extra = {
      truncated: true,
      ...elidedFields(elided),
      truncation_note: ELIDE_NOTE,
    };
    result =
      meta !== undefined
        ? { data: value, meta, ...extra }
        : { ...value, ...extra };
  } else {
    result = meta !== undefined ? { data, meta } : data;
  }

  // Invariant backstop: whatever the shape, never hand back something over the
  // ceiling. If slicing/eliding didn't get it under, withhold it wholesale.
  const size = jsonLen(result);
  return size > MAX_BYTES ? tooLargeMarker(size, meta) : result;
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
 *  - returns `data` (plus `meta` when paginated), capping oversized payloads
 *    (arrays and objects alike) with a `truncated` flag — guaranteed to serialize
 *    under MAX_BYTES so one call can't blow the context window.
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
