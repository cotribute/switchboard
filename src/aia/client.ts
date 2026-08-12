import { AxiosInstance } from "axios";

// Spec §2: on HTTP 429 retry up to 3 times with exponential backoff.
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
 *  - retries HTTP 429 up to 3× with 1s / 2s / 4s backoff;
 *  - returns `data`, plus `meta` when the response is paginated. Strips nothing
 *    else.
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

  let lastError: any;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await axiosInstance.get(path, { params: cleanParams });
      const body = response.data;
      const err = aiaError(body);
      if (err) throw err;
      if (body && typeof body === "object" && body.meta) {
        return { data: body.data, meta: body.meta };
      }
      return body && typeof body === "object" && "data" in body
        ? body.data
        : body;
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 429 && attempt < RETRY_DELAYS_MS.length) {
        lastError = error;
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      // Prefer AIA's structured error over the raw axios message.
      const structured = aiaError(error.response?.data);
      if (structured) throw structured;
      throw error;
    }
  }
  throw lastError;
}
