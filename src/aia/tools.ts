// AIA (AI Institution Advisor) tools — a read-only wrapper over the AIA Public
// API. Internal-only: one unscoped key reads every institution.
//
// NOTE ON THIS FILE: descriptions are kept terse on purpose — every exposed
// tool's schema is injected into the model's context on every request. The
// guidance below lives here (comments don't load) rather than repeated in each
// tool description:
//   - Data is research OUTPUT, not a live scrape; each payload carries `as_of_date`.
//   - When a user names an institution in prose, resolve it first via
//     aia_suggest_institutions (or aia_lookup_institution), then carry the
//     returned UUID on every follow-up call. Slugs are NOT globally unique (many
//     legal names repeat across states), so an ambiguous slug hits an arbitrary
//     row; slugs are only safe for the small set of Dream Bigger client orgs.
//   - Regulator facts (assets, membership, charter) are authoritative over
//     anything in narrative text. Keep Deposits and Loans strictly separate.
//   - aia_search_institutions accepts extra niche filters (ncua, fdic, ids, slugs,
//     has_*, excluded_from_research, updated_since(_field), stale_before(_field))
//     that are NOT in its schema — best-effort only: schema-validating MCP clients
//     strip unknown keys, so these reach the API on non-validating clients alone.
//     For ncua/fdic use aia_lookup_institution (reliable everywhere).
//   - The per-payload research getters are consolidated into
//     aia_get_institution_bundle (everything) + aia_get_institution_section (one
//     slice). The ops/admin group (`opsTools`) loads only when AIA_ENABLE_OPS is set.

const ID_DESC = "Institution UUID (from aia_suggest_institutions) or slug.";

// ── Core tools (always exposed) ─────────────────────────────────────────────
export const tools = [
  // ── Discovery ──────────────────────────────────────────────────────────
  {
    name: "aia_search_institutions",
    description:
      "Search/filter all AIA institutions (CUs + banks). Primary tool for " +
      "market-wide questions (e.g. 'top 20 Texas CUs by assets') — filter rather " +
      "than looking up one at a time. Page large result sets with cursor.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Free-text name search." },
        type: { type: "string", enum: ["cu", "bank"] },
        state: { type: "string", description: "Two-letter state code." },
        org_segment: {
          type: "string",
          description: "Segment slug (see aia_list_segments).",
        },
        sort: {
          type: "string",
          enum: [
            "name",
            "monthly_research_refresh_date",
            "market_research_refresh_date",
            "assets",
            "membership",
            "founded",
          ],
        },
        order: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "number", description: "1–100 per page." },
        cursor: { type: "string", description: "Pagination offset." },
      },
    },
  },
  {
    name: "aia_lookup_institution",
    description:
      "Deterministic lookup by ncua/fdic (cleanest) or exact name (+state). " +
      "Returns state/assets/regulator ids to disambiguate same-named orgs.",
    inputSchema: {
      type: "object",
      properties: {
        ncua: { type: "string", description: "NCUA charter number." },
        fdic: { type: "string", description: "FDIC certificate number." },
        name: { type: "string", description: "Exact institution name." },
        state: {
          type: "string",
          description: "Two-letter state code (with name).",
        },
      },
    },
  },
  {
    name: "aia_suggest_institutions",
    description:
      "Typeahead resolver — call first when a user names an institution in prose. " +
      "Returns candidates w/ UUID + disambiguators; carry the chosen UUID onward.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search text, 2+ characters." },
        limit: { type: "number", description: "1–25 (default per API)." },
      },
      required: ["q"],
    },
  },
  {
    name: "aia_list_segments",
    description: "List the org segments used by the org_segment filter.",
    inputSchema: { type: "object", properties: {} },
  },

  // ── Institution research ───────────────────────────────────────────────
  {
    name: "aia_get_institution_bundle",
    description:
      "Profile + every research payload for one institution in one (large) call. " +
      "Use only for genuinely broad asks; for a single slice prefer " +
      "aia_get_institution_section.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: ID_DESC } },
      required: ["id"],
    },
  },
  {
    name: "aia_get_institution_section",
    description:
      "One research slice for an institution (bundle for several). products accepts " +
      "category (deposits|loans).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: ID_DESC },
        section: {
          type: "string",
          enum: [
            "profile",
            "products",
            "top_products",
            "personas",
            "ai_strategy",
            "highlights",
            "weekly_market",
            "cta_urls",
          ],
          description: "Which research slice to return.",
        },
        category: {
          type: "string",
          enum: ["deposits", "loans"],
          description: "Only used when section=products.",
        },
      },
      required: ["id", "section"],
    },
  },
  {
    name: "aia_compare_institutions",
    description:
      "Compare two institutions (shared / only_a / only_b per payload). Use UUIDs.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: `Institution A. ${ID_DESC}` },
        with: { type: "string", description: "Institution B (UUID or slug)." },
      },
      required: ["id", "with"],
    },
  },

  // ── Cross-org analysis ─────────────────────────────────────────────────
  {
    name: "aia_search_products",
    description:
      "Search products across all institutions (Deposits/Loans stay distinct).",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search text, 2+ characters." },
        limit: { type: "number", description: "1–200." },
        cursor: { type: "string", description: "Pagination offset." },
      },
      required: ["q"],
    },
  },
  {
    name: "aia_list_rates",
    description:
      "Rates across all institutions. Prefer `kind` (reliable enum) over `category` " +
      "(free-text; e.g. category='cd' returns nothing, kind='deposit' captures CDs).",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["deposit", "loan", "fee", "reward", "unknown"],
          description: "Normalized rate class; CDs fall under 'deposit'.",
        },
        category: {
          type: "string",
          description:
            "Free-text category substring (less reliable than kind).",
        },
        limit: { type: "number", description: "1–500." },
        cursor: { type: "string", description: "Pagination offset." },
      },
    },
  },
  {
    name: "aia_get_coverage_stats",
    description: "Dataset coverage / freshness statistics.",
    inputSchema: {
      type: "object",
      properties: {
        stale_days: {
          type: "number",
          description: "Staleness threshold in days (default 90).",
        },
      },
    },
  },
];

// ── Ops / admin tools (exposed only when AIA_ENABLE_OPS is set) ──────────────
export const opsTools = [
  {
    name: "aia_get_institution_freshness",
    description: "Data age + site-monitor state for one institution.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: ID_DESC } },
      required: ["id"],
    },
  },
  {
    name: "aia_list_stale_institutions",
    description:
      "Institutions whose research is older than the given staleness threshold.",
    inputSchema: {
      type: "object",
      properties: {
        stale_days: {
          type: "number",
          description: "Staleness threshold in days.",
        },
      },
    },
  },
  {
    name: "aia_list_product_changes",
    description:
      "Recent product changes, optionally scoped to one institution.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "ISO-8601 date/time." },
        institution_id: {
          type: "string",
          description: "AIA UUID to scope changes to one institution.",
        },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "aia_get_job_status",
    description: "Status of a research job by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Research job id." } },
      required: ["id"],
    },
  },
  {
    name: "aia_get_audit_feed",
    description:
      "Internal audit feed of product changes, research runs, and snapshots.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["all", "product_change", "research_run", "snapshot"],
        },
        q: { type: "string" },
        limit: { type: "number" },
        cursor: { type: "string", description: "Pagination offset." },
      },
    },
  },
  {
    name: "aia_get_cost_usage",
    description:
      "Research cost/usage over a date range. Always pass `from` and `to` — an " +
      "unbounded query scans all history and can time out.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO-8601 start (recommended)." },
        to: { type: "string", description: "ISO-8601 end (recommended)." },
      },
    },
  },
  {
    name: "aia_whoami",
    description:
      "Echo the calling key's scopes, tenancy, and remaining rate limit. Use to " +
      "diagnose access (e.g. a 403 or an unexpectedly narrowed result set).",
    inputSchema: { type: "object", properties: {} },
  },
];
