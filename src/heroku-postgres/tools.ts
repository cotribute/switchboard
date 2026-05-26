export const tools = [
  // ── Transaction tools (default env: "prod") ──────────────────────────────

  {
    name: "db_lookup_user",
    description:
      "Look up a financial_user by login_id. Email is the most common login_id, but phone numbers also work — the result includes the matched login_id_type. Returns user ID, name, login info, financial institution, and timestamps. Use this first when you have a customer's email (or phone) from a support ticket. Defaults to prod.",
    inputSchema: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description:
            "Login identifier — typically an email address, sometimes a phone number. Matched against financial_users.login_id exactly.",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: prod)",
        },
      },
      required: ["email"],
    },
  },
  {
    name: "db_get_recent_applications",
    description:
      "Get the most recent onboarding applications for a financial_user. Returns application ID, status, decision status, flow name, and timestamps. Defaults to prod.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "financial_users.id (UUID)" },
        limit: {
          type: "number",
          description: "Number of results (default 5, max 20)",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: prod)",
        },
      },
      required: ["user_id"],
    },
  },
  {
    name: "db_get_application_details",
    description:
      "Get full details for a specific onboarding application: status, decision status, flow name, financial institution, and timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: prod)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "db_get_fraud_results",
    description:
      "Get fraud check results and individual reason codes for an application. Returns category, scope, risk_score, and the array of reason codes. Use when an application was flagged or denied for fraud-related reasons.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: prod)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "db_get_vouched_results",
    description:
      "Get Vouched document-verification job results for an application. Returns job status, success boolean, and stage. Used for the older Vouched IDV flow (Plaid IDV results live in coadmin_get_plaid_idv_documents).",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: prod)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "db_get_stripe_payments",
    description:
      "Get Stripe PaymentIntents for an onboarding application. Returns payment intent ID, status, amount, currency, and creation time. Use for Stripe-based funding flows. (Repay payments live in coadmin_get_repay_payments.)",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: prod)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "db_get_otp_history",
    description:
      "Get recent OTP code deliveries and Twilio verification attempts for a financial_user. Use for login and access issues. Returns OTP creation/verification timestamps and Twilio status/channel/destination.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "financial_users.id (UUID)" },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: prod)",
        },
      },
      required: ["user_id"],
    },
  },

  // ── Config tools (default env: "sandbox") ────────────────────────────────

  {
    name: "db_get_flow_config",
    description:
      "Get the flow configuration for a specific flow ID. Returns the flow name, settings JSON (step graph, branding, integration toggles), and associated FI/product. Useful when a client reports unexpected flow behavior — check sandbox first to see what they've configured. Defaults to sandbox.",
    inputSchema: {
      type: "object",
      properties: {
        flow_id: { type: "string", description: "flows.id (UUID)" },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: sandbox)",
        },
      },
      required: ["flow_id"],
    },
  },
  {
    name: "db_get_fi_flows",
    description:
      "List all flows configured for a financial institution. Returns flow IDs, names, and associated products. Use to find the right flow_id when a client describes an issue without providing one. Defaults to sandbox.",
    inputSchema: {
      type: "object",
      properties: {
        fi_id: {
          type: "string",
          description: "financial_institutions.id (UUID)",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: sandbox)",
        },
      },
      required: ["fi_id"],
    },
  },
  {
    name: "db_get_decision_rules",
    description:
      "Get decision rules for a financial institution product. Shows the conditions (jsonb) and outcome statuses configured. Use when a client questions why an application received a particular decision. Defaults to sandbox.",
    inputSchema: {
      type: "object",
      properties: {
        fi_product_id: {
          type: "string",
          description: "financial_institution_products.id (UUID)",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: sandbox)",
        },
      },
      required: ["fi_product_id"],
    },
  },
  {
    name: "db_get_fi_products",
    description:
      "List products configured for a financial institution. Returns product IDs, names, slugs, and meta. Use to find fi_product_id when a client doesn't provide it directly. Defaults to sandbox.",
    inputSchema: {
      type: "object",
      properties: {
        fi_id: {
          type: "string",
          description: "financial_institutions.id (UUID)",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: sandbox)",
        },
      },
      required: ["fi_id"],
    },
  },
  {
    name: "db_get_fi_by_name",
    description:
      "Look up a financial institution by name (partial match, case-insensitive). Returns FI ID, full name, and created date. Use this to resolve an FI name to an ID before calling other config tools.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Financial institution name or partial name",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: sandbox)",
        },
      },
      required: ["name"],
    },
  },

  // ── Legacy bridge (default env: "prod") ──────────────────────────────────

  {
    name: "db_lookup_organization_for_fi",
    description:
      "Resolve the legacy WeServe `organizations` row that corresponds to an Acquire-stack financial institution. The link is `organizations.meta->>'financialInstitutionId' = fi_id`. Returns the integer org id, name, slug, and created_at. Use when a customer references a legacy org id/slug and you need to bridge to the modern FI record (or vice versa).",
    inputSchema: {
      type: "object",
      properties: {
        fi_id: {
          type: "string",
          description: "financial_institutions.id (UUID)",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: prod)",
        },
      },
      required: ["fi_id"],
    },
  },
  {
    name: "db_get_submission_application",
    description:
      "Given a legacy `submissions.id` (integer), return the linked Acquire `onboarding_applications` row. Submissions is the legacy form-submission model; many CX tickets still quote a submissions.id. The FK is `submissions.onboarding_application_id`. Returns the onboarding app id, status, flow_id, financial_user_id, timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        submission_id: {
          type: "number",
          description: "submissions.id (integer)",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: prod)",
        },
      },
      required: ["submission_id"],
    },
  },

  // ── Application underwriting (default env: "prod") ───────────────────────

  {
    name: "db_get_application_financial_application",
    description:
      "Get the `financial_applications` row(s) for an onboarding application — the underwriting projection (loan amount, opening deposit, share product chosen, applicant/co-applicant UUIDs, payment term). Useful when the onboarding shell exists but you need the canonical underwriting snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: prod)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "db_get_watchlist_results",
    description:
      "Get OFAC / sanctions watchlist screening results for an application. Returns the chain of orders → reports → hits, joined via the application's financial_applications.uuid. Each hit includes score_percent, description, and the raw vendor data jsonb.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: prod)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "db_get_credit_report",
    description:
      "Get credit-bureau pull metadata for an application: `financial_application_credit_reports` rows (bureau, product, scope, received_at) and `corelation_credit_pulls` rows (type/user/credit_pull serials, status, error). NOTE: the raw report bodies are encrypted at rest — these are returned by coadmin-api with decryption, not here. This tool surfaces only the unencrypted envelope.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: prod)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "db_get_business_verification",
    description:
      "Get business-verification artifacts for an application. Returns `middesk_objects` rows (Middesk business verification — linked via external_id = application_id) plus `fis_product_evaluations` rows (FIS product-eligibility evals, joined via fis_gkyc_evaluations.onboarding_application_id).",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: prod)",
        },
      },
      required: ["application_id"],
    },
  },

  // ── Flow internals (default env: "sandbox") ──────────────────────────────

  {
    name: "db_get_flow_actions",
    description:
      "List the configured action steps for a flow and their attached transforms. Joins `flow_action_configurations` to `flow_transform_configurations`. Each action returns trigger, handler, sort_order, settings jsonb, conditions jsonb, and (if linked) the transform's transform_key + settings.",
    inputSchema: {
      type: "object",
      properties: {
        flow_id: { type: "string", description: "flows.id (UUID)" },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: sandbox)",
        },
      },
      required: ["flow_id"],
    },
  },
  {
    name: "db_get_flow_routing",
    description:
      "Get server-side routing config for a flow: `flow_transition_rules` (conditional routing — step_slug → next_step_slug with conditions, in execution order) and `prefill_templates` (how external prefill data maps into the flow). Use when a flow routes unexpectedly or prefill isn't populating fields.",
    inputSchema: {
      type: "object",
      properties: {
        flow_id: { type: "string", description: "flows.id (UUID)" },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: sandbox)",
        },
      },
      required: ["flow_id"],
    },
  },
  {
    name: "db_get_flow_offers",
    description:
      "List cross-sell offers configured for a flow. Joins `flow_offers` to the offered `share_products` so you see the product slug/title alongside the offer's display_order, conditions, and meta. Useful when an applicant questions an offer they were (or weren't) shown.",
    inputSchema: {
      type: "object",
      properties: {
        flow_id: { type: "string", description: "flows.id (UUID)" },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: sandbox)",
        },
      },
      required: ["flow_id"],
    },
  },

  // ── Product / decisioning config (default env: "sandbox") ────────────────

  {
    name: "db_get_decision_statuses",
    description:
      "List the decision statuses configured for a financial_institution_product. Each row: uuid, slug, title, sort_order, decision text, locked flag. Use to see the full outcome catalog for a product (e.g. all the approved/denied/manual-review variants).",
    inputSchema: {
      type: "object",
      properties: {
        fi_product_id: {
          type: "string",
          description: "financial_institution_products.id (UUID)",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: sandbox)",
        },
      },
      required: ["fi_product_id"],
    },
  },
  {
    name: "db_get_fi_share_products",
    description:
      "List share/account products for a financial institution, joined to their share_categories. Each row: product slug/title, category slug/title, minimum_opening_deposit, maturity period, visibility_conditions jsonb. Use to see what accounts an FI exposes (Savings, Checking, Certificates, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        fi_id: {
          type: "string",
          description: "financial_institutions.id (UUID)",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: sandbox)",
        },
      },
      required: ["fi_id"],
    },
  },
  {
    name: "db_get_flow_mapping_templates",
    description:
      "Resolve the financial_application mapping templates referenced by a flow. Reads `flows.settings->'financialApplicationMapping'` (which may be a single object or array of {templateUUID, partial?, conditions?}) and joins to `financial_application_mapping_templates`. Each result: slug, template jsonb, answer_mapping_dictionary jsonb, template_engine ('handlebars' or 'jsonata'), plus the per-flow `partial` flag and `conditions`. Use when investigating why the canonical financial_application doesn't reflect a flow response.",
    inputSchema: {
      type: "object",
      properties: {
        flow_id: { type: "string", description: "flows.id (UUID)" },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: sandbox)",
        },
      },
      required: ["flow_id"],
    },
  },

  // ── Core banking config (default env: "sandbox") ─────────────────────────

  {
    name: "db_get_core_banking_config",
    description:
      "List `core_banking_configurations` for a financial institution. Each row: configuration uuid, adapter slug + description, brief description text, updated_at. This is the master per-FI/per-adapter config the runtime reads (Symitar, Corelation, DNA, Sync1, etc.). Use to discover which configs exist before fetching detail.",
    inputSchema: {
      type: "object",
      properties: {
        fi_id: {
          type: "string",
          description: "financial_institutions.id (UUID)",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: sandbox)",
        },
      },
      required: ["fi_id"],
    },
  },
  {
    name: "db_get_core_banking_config_detail",
    description:
      "Get full detail of a single `core_banking_configurations` row: settings jsonb, field_mappings jsonb, adapter info, plus any per-config decision-status mappings (corelation/symitar/sync1) that reference this configuration. Use when investigating core-banking behaviour for a specific FI+adapter combo.",
    inputSchema: {
      type: "object",
      properties: {
        config_id: {
          type: "string",
          description: "core_banking_configurations.uuid",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: sandbox)",
        },
      },
      required: ["config_id"],
    },
  },
  {
    name: "db_business_outcomes_battery",
    description:
      "Runs the full standard query battery for the /generate-business-outcomes Cowork skill against the replica for one FI and returns everything the skill needs to write a markdown business-outcomes document: resolved FI + brand, product overview, decision distribution, flow breakdown, risk signals (Fraud Guard+, Cotribute IDV, ChexSystems, FIS GKYC), OFAC, decision automation, time-to-decision, unique users, monthly trend, and loan dollars. " +
      "Pass `fi_query` as a name fragment, slug, or UUID — ambiguous matches return { ambiguous: true, candidates: [...] } instead of data so the caller can disambiguate by re-calling with the chosen id. " +
      "Use ONLY for the business-outcomes workflow; for individual application or user lookups, prefer the focused db_* tools.",
    inputSchema: {
      type: "object",
      properties: {
        fi_query: {
          type: "string",
          description:
            "Name fragment, slug, or UUID identifying the financial institution. Examples: 'Fort Financial', 'fort-financial-cu', '1588cdcc-8ec9-4c50-ac5d-ddfaf99f73d9'.",
        },
        end_date: {
          type: "string",
          description:
            "Reporting period end (YYYY-MM-DD). Defaults to today. Used to bound the risk-signal cohort; other queries are not date-bounded (matches the validated reference behaviour).",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: prod)",
        },
      },
      required: ["fi_query"],
    },
  },
  {
    name: "db_fgp_utilization_battery",
    description:
      "Runs the FraudGuard+ (FGP/BG) utilization battery for the /generate-fgp-utilization Cowork skill against the replica over a date window and returns compact per-FI billable/non-billable aggregates. " +
      "FGP is billed per APPLICANT, per inquiry: for one person, an Effectiv fraud check OR a Plaid IDV session (OR both) = ONE billable inquiry; joint applicants and beneficial owners are separate inquiries. The tool dedupes per person using normalized firstName|lastName|dob (Plaid IDV has no SSN and its 'govt-id' slug is not per-person), classifies each inquiry billable vs non-billable (failed-pre-vendor, duplicate retries, demo/test FI), and returns per-FI counts plus raw vendor-call (cost-side) counts. " +
      "Pass start_date (inclusive) and end_date (exclusive) as YYYY-MM-DD. Omit fi_query for all FIs (monthly invoice run) or pass a name/slug/uuid to scope to one FI; an ambiguous fi_query returns { ambiguous: true, candidates: [...] }. Pass include_detail:true (single FI only) for per-applicant detail rows. " +
      "Use ONLY for the FGP-utilization workflow.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: {
          type: "string",
          description: "Window start, inclusive (YYYY-MM-DD).",
        },
        end_date: {
          type: "string",
          description: "Window end, exclusive (YYYY-MM-DD).",
        },
        fi_query: {
          type: "string",
          description:
            "Optional FI filter — name fragment, slug, or UUID. Omit to report all FIs.",
        },
        include_detail: {
          type: "boolean",
          description:
            "When true AND fi_query resolves to a single FI, also return per-applicant detail rows (capped at 5000). Ignored for all-FI runs.",
        },
        env: {
          type: "string",
          enum: ["prod", "sandbox"],
          description: "Database environment (default: prod)",
        },
      },
      required: ["start_date", "end_date"],
    },
  },
];
