import { AxiosInstance } from "axios";
import { aiaGet } from "./client.js";

// Institution identifiers accept a UUID or a slug; both go in the path segment.
const seg = (v: string) => encodeURIComponent(String(v));
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.trunc(n)));

// Params passed through verbatim by aia_search_institutions / aia_export_institutions.
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

  return {
    // ── Discovery ───────────────────────────────────────────────────────────
    aia_search_institutions: (args) =>
      get("/institutions", {
        ...pick(args, SEARCH_KEYS),
        limit: args.limit !== undefined ? clamp(args.limit, 1, 100) : undefined,
        cursor: args.cursor,
      }),

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
        limit: args.limit !== undefined ? clamp(args.limit, 1, 25) : undefined,
      });
    },

    aia_list_segments: () => get("/segments"),

    // ── Institution research ────────────────────────────────────────────────
    aia_get_institution_profile: (args) => get(`/institutions/${seg(args.id)}`),

    aia_get_institution_bundle: (args) =>
      get(`/institutions/${seg(args.id)}/bundle`),

    aia_get_products: (args) => {
      if (args.category && !["deposits", "loans"].includes(args.category)) {
        throw new Error("category must be 'deposits' or 'loans'");
      }
      return get(
        `/institutions/${seg(args.id)}/products`,
        pick(args, ["category"])
      );
    },

    aia_get_top_products: (args) =>
      get(`/institutions/${seg(args.id)}/top-products`),

    aia_get_personas: (args) => get(`/institutions/${seg(args.id)}/personas`),

    aia_get_ai_strategy: (args) =>
      get(`/institutions/${seg(args.id)}/ai-strategy`),

    aia_get_key_highlights: (args) =>
      get(`/institutions/${seg(args.id)}/highlights`),

    aia_get_weekly_market: (args) =>
      get(`/institutions/${seg(args.id)}/weekly-market`),

    aia_get_cta_urls: (args) => get(`/institutions/${seg(args.id)}/cta-urls`),

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
        limit: args.limit !== undefined ? clamp(args.limit, 1, 200) : undefined,
        cursor: args.cursor,
      });
    },

    aia_list_rates: (args) =>
      get("/rates", {
        category: args.category,
        limit: args.limit !== undefined ? clamp(args.limit, 1, 500) : undefined,
        cursor: args.cursor,
      }),

    aia_get_coverage_stats: (args) =>
      get("/stats/coverage", pick(args, ["stale_days"])),

    aia_export_institutions: (args) =>
      get("/institutions/export", {
        format: args.format || "json",
        ...pick(args, SEARCH_KEYS),
        limit:
          args.limit !== undefined ? clamp(args.limit, 1, 5000) : undefined,
      }),

    // ── Ops / admin ─────────────────────────────────────────────────────────
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
  };
}
