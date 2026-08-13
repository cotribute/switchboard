// AIA (AI Institution Advisor) tools — a read-only wrapper over the AIA Public
// API. Internal-only: one unscoped key reads every institution. All data is
// research output, NOT a live scrape — `as_of_date` on a payload indicates its
// recency. When the user names an institution in prose, resolve it first with
// aia_suggest_institutions (or aia_lookup_institution) and then carry the
// returned UUID on every follow-up call — slugs are NOT globally unique (many
// legal names repeat across different states), so an ambiguous slug resolves to
// an arbitrary row. Slugs are only safe for the small set of Dream Bigger client
// institutions.
//
// Tool surface is kept lean to conserve model context: the per-payload research
// getters are consolidated into aia_get_institution_bundle (everything at once)
// + aia_get_institution_section (one slice). The ops/admin group (`opsTools`)
// is exported separately and only exposed when AIA_ENABLE_OPS is set.

const ID_DESC =
  "AIA institution UUID (preferred) or slug. Use the UUID returned by " +
  "aia_suggest_institutions / aia_lookup_institution for anything resolved by " +
  "name — slugs are not globally unique. Slugs are only safe for the ~41 Dream " +
  "Bigger client institutions.";

// ── Core tools (always exposed) ─────────────────────────────────────────────
export const tools = [
  // ── Discovery ──────────────────────────────────────────────────────────
  {
    name: "aia_search_institutions",
    description:
      "Search/filter the ~6,073 institutions in AIA (credit unions + banks). " +
      "The key is unscoped, so this is the primary tool for market-wide questions " +
      "(e.g. 'top 20 Texas CUs by assets') — filter, don't look up one at a time. " +
      "Regulator facts (assets, membership) are authoritative over narrative text.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Free-text name search." },
        type: {
          type: "string",
          enum: ["cu", "bank"],
          description: "Institution type.",
        },
        state: { type: "string", description: "Two-letter state code." },
        org_segment: {
          type: "string",
          description: "Segment slug (see aia_list_segments).",
        },
        ncua: { type: "string", description: "NCUA charter number." },
        fdic: { type: "string", description: "FDIC certificate number." },
        ids: { type: "string", description: "Comma-separated AIA UUIDs." },
        slugs: { type: "string", description: "Comma-separated slugs." },
        has_website: { type: "boolean" },
        has_products: { type: "boolean" },
        has_top_products: { type: "boolean" },
        has_personas: { type: "boolean" },
        has_ai_strategy: { type: "boolean" },
        excluded_from_research: { type: "boolean" },
        updated_since: { type: "string", description: "ISO-8601 date." },
        updated_since_field: { type: "string" },
        stale_before: { type: "string", description: "ISO-8601 date." },
        stale_before_field: { type: "string" },
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
        limit: { type: "number", description: "1–100 (default per API)." },
        cursor: {
          type: "string",
          description: "Pagination offset from meta.next_cursor.",
        },
      },
    },
  },
  {
    name: "aia_lookup_institution",
    description:
      "Deterministic single-institution lookup by regulator number or exact name. " +
      "Prefer ncua/fdic when available (cleanest match); otherwise name (+ state to " +
      "disambiguate). Returns state/assets/regulator numbers so you can confirm the " +
      "right org when several share a name.",
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
      "Typeahead resolver — the first call to make when the user names an institution " +
      "in prose. Returns candidates with UUID, state, assets, and regulator numbers so " +
      "you can disambiguate; ask the user which one rather than guessing, then carry " +
      "the chosen UUID on every follow-up call.",
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
      "Profile PLUS every research payload for one institution in a single call — " +
      "firmographics, products, top-products, personas, ai-strategy, highlights, " +
      "weekly-market, cta-urls. Prefer this for any broad question. Research output, " +
      "not a live scrape — check each payload's as_of_date for recency.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: ID_DESC } },
      required: ["id"],
    },
  },
  {
    name: "aia_get_institution_section",
    description:
      "Fetch ONE research slice for an institution (use aia_get_institution_bundle " +
      "if you want several). Deposits vs Loans stay strictly separate in any summary. " +
      "Sections: profile (firmographics, regulator ids), products (deposit/loan " +
      "products; accepts category), top_products (ranked w/ factor scores), personas, " +
      "ai_strategy, highlights, weekly_market (market & competitor research), cta_urls.",
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
      "Compare two institutions, returning shared / only_a / only_b per research " +
      "payload. Use UUIDs for both when either was resolved by name.",
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
      "Search products across ALL institutions (the non-client corpus is the " +
      "comparison set). Keep Deposits and Loans distinct in any summary.",
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
      "Rates across all institutions — the comparison set for market-wide rate " +
      "questions (e.g. 'median 12-month CD rate'). Prefer the `kind` filter: it is a " +
      "reliable derived enum, whereas `category` is a free-text substring match against " +
      "raw labels (e.g. category='cd' returns nothing; kind='deposit' captures CDs).",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["deposit", "loan", "fee", "reward", "unknown"],
          description:
            "Normalized rate class (reliable). CDs/certificates fall under 'deposit'. " +
            "Distinct from research-job kind.",
        },
        category: {
          type: "string",
          description:
            "Free-text category substring (e.g. 'Checking Accounts'); less reliable than kind.",
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
  {
    name: "aia_export_institutions",
    description:
      "Bulk export of institutions (format=json for tool use) with the same filters as " +
      "aia_search_institutions. Use for large cross-org pulls; limit up to 5000.",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["json"],
          description: "Use 'json' for tool use.",
        },
        q: { type: "string" },
        type: { type: "string", enum: ["cu", "bank"] },
        state: { type: "string" },
        org_segment: { type: "string" },
        ncua: { type: "string" },
        fdic: { type: "string" },
        ids: { type: "string" },
        slugs: { type: "string" },
        has_website: { type: "boolean" },
        has_products: { type: "boolean" },
        has_top_products: { type: "boolean" },
        has_personas: { type: "boolean" },
        has_ai_strategy: { type: "boolean" },
        excluded_from_research: { type: "boolean" },
        updated_since: { type: "string" },
        updated_since_field: { type: "string" },
        stale_before: { type: "string" },
        stale_before_field: { type: "string" },
        sort: { type: "string" },
        order: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "number", description: "Up to 5000." },
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
    description: "Research cost/usage over a date range.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO-8601 start." },
        to: { type: "string", description: "ISO-8601 end." },
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
