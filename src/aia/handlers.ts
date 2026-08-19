import { AxiosInstance } from "axios";
import { aiaGet } from "./client.js";

// Institution / job identifiers accept a UUID or a slug; both go in the path
// segment. Reject a missing id up front so an omitted required arg yields a clear
// error instead of a confusing "/institutions/undefined/..." 404 downstream.
const seg = (v: string) => {
  if (v === undefined || v === null || String(v).trim() === "") {
    throw new Error("A required id (UUID or slug) is missing.");
  }
  return encodeURIComponent(String(v));
};
// Coerce a caller-supplied limit into [lo, hi], or undefined (→ API default) when
// it isn't a finite number — a model can pass e.g. "twenty", and NaN on the wire
// would just 400.
const toLimit = (v: unknown, lo: number, hi: number): number | undefined => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
};

// Best-effort passthrough filters for aia_search_institutions. NOTE: these are
// NOT declared in the tool's inputSchema, so schema-validating MCP clients strip
// them before the call and they silently no-op there; they only reach the API on
// non-validating clients. For ncua/fdic, aia_lookup_institution is the reliable path.
const SEARCH_KEYS = [
  "q",
  "type",
  "state",
  "org_segment",
  "ncua",
  "fdic",
  "ids",
  "slugs",
  "has_website",
  "has_products",
  "has_top_products",
  "has_personas",
  "has_ai_strategy",
  "excluded_from_research",
  "updated_since",
  "updated_since_field",
  "stale_before",
  "stale_before_field",
  "sort",
  "order",
] as const;

// section value -> path suffix under /institutions/{id}
const SECTION_PATHS: Record<string, string> = {
  profile: "",
  products: "/products",
  top_products: "/top-products",
  personas: "/personas",
  ai_strategy: "/ai-strategy",
  highlights: "/highlights",
  weekly_market: "/weekly-market",
  cta_urls: "/cta-urls",
};

function pick(args: any, keys: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of keys) if (args?.[k] !== undefined) out[k] = args[k];
  return out;
}

export function createHandlers(
  axiosInstance: AxiosInstance
): Record<string, (args: any) => Promise<any>> {
  const get = (path: string, params?: Record<string, any>) =>
    aiaGet(axiosInstance, path, params);

  const handlers: Record<string, (args: any) => Promise<any>> = {
    // ── Discovery ───────────────────────────────────────────────────────────
    aia_search_institutions: (args) => {
      // Require at least one filter so the model can't default to an unfiltered
      // full-table scan (the schema has no required field by design — several
      // filters are valid entry points, not just q).
      if (!args.q && !args.type && !args.state && !args.org_segment) {
        throw new Error(
          "aia_search_institutions requires at least one of: q, type, state, org_segment"
        );
      }
      // Paginated list endpoint (limit ≤100 + cursor); the response cap in aiaGet
      // bounds the result. SEARCH_KEYS passthrough is best-effort (see its note).
      return get("/institutions", {
        ...pick(args, SEARCH_KEYS),
        limit: toLimit(args.limit, 1, 100),
        cursor: args.cursor,
      });
    },

    aia_lookup_institution: (args) => {
      if (!args.ncua && !args.fdic && !args.name) {
        throw new Error(
          "aia_lookup_institution requires one of: ncua, fdic, name"
        );
      }
      return get(
        "/institutions/lookup",
        pick(args, ["ncua", "fdic", "name", "state"])
      );
    },

    aia_suggest_institutions: (args) => {
      if (!args.q || String(args.q).trim().length < 2) {
        throw new Error(
          "aia_suggest_institutions requires q of at least 2 characters"
        );
      }
      return get("/search/suggest", {
        q: args.q,
        limit: toLimit(args.limit, 1, 25),
      });
    },

    aia_list_segments: () => get("/segments"),

    // ── Institution research ────────────────────────────────────────────────
    aia_get_institution_bundle: (args) =>
      get(`/institutions/${seg(args.id)}/bundle`),

    aia_get_institution_section: (args) => {
      // hasOwnProperty guard: a plain-object lookup would resolve inherited keys
      // like "constructor"/"toString" to functions, which then get interpolated
      // into the URL. Only accept declared sections.
      if (!Object.prototype.hasOwnProperty.call(SECTION_PATHS, args.section)) {
        throw new Error(
          `Unknown section '${args.section}'. Valid: ${Object.keys(SECTION_PATHS).join(", ")}`
        );
      }
      const suffix = SECTION_PATHS[args.section];
      if (
        args.section === "products" &&
        args.category &&
        !["deposits", "loans"].includes(args.category)
      ) {
        throw new Error("category must be 'deposits' or 'loans'");
      }
      const params =
        args.section === "products" && args.category
          ? { category: args.category }
          : undefined;
      return get(`/institutions/${seg(args.id)}${suffix}`, params);
    },

    aia_compare_institutions: (args) => {
      if (!args.with)
        throw new Error("aia_compare_institutions requires 'with'");
      return get(`/institutions/${seg(args.id)}/compare`, { with: args.with });
    },

    // ── Cross-org analysis ──────────────────────────────────────────────────
    aia_search_products: (args) => {
      if (!args.q || String(args.q).trim().length < 2) {
        throw new Error(
          "aia_search_products requires q of at least 2 characters"
        );
      }
      return get("/products/search", {
        q: args.q,
        limit: toLimit(args.limit, 1, 200),
        cursor: args.cursor,
      });
    },

    aia_list_rates: (args) =>
      get("/rates", {
        kind: args.kind,
        category: args.category,
        limit: toLimit(args.limit, 1, 500),
        cursor: args.cursor,
      }),

    aia_get_coverage_stats: (args) =>
      get("/stats/coverage", pick(args, ["stale_days"])),

    // ── Ops / admin (gated by AIA_ENABLE_OPS: when off, server.ts replaces
    //    these with a stub that refuses invocation — not just hidden) ──────────
    aia_get_institution_freshness: (args) =>
      get(`/institutions/${seg(args.id)}/freshness`),

    aia_list_stale_institutions: (args) =>
      get("/freshness", pick(args, ["stale_days"])),

    aia_list_product_changes: (args) =>
      get("/changes", pick(args, ["since", "institution_id", "limit"])),

    aia_get_job_status: (args) => get(`/jobs/${seg(args.id)}`),

    aia_get_audit_feed: (args) =>
      get("/admin/audit", pick(args, ["kind", "q", "limit", "cursor"])),

    aia_get_cost_usage: (args) =>
      get("/admin/cost-usage", pick(args, ["from", "to"])),

    aia_whoami: () => get("/me"),
  };

  // MCP call_tool may omit `arguments`, so `args` can arrive undefined. Default
  // it to {} for every handler so none throws a TypeError before its own
  // validation runs.
  return Object.fromEntries(
    Object.entries(handlers).map(([name, fn]) => [
      name,
      (args: any) => fn(args ?? {}),
    ])
  );
}
