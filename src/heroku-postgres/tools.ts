export const tools = [
  // ── Transaction tools (default env: "prod") ──────────────────────────────

  {
    name: "db_lookup_user",
    description:
      "Look up a financial_user by email address. Returns user ID, financial institution name and ID, and timestamps. Use this first when you have a customer's email from a support ticket. Defaults to prod.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Customer email address" },
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
      "Get the most recent onboarding applications for a financial_user. Returns application ID, status, current step slug, decision status, flow name, and timestamps. Defaults to prod.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "financial_users.id (UUID)" },
        limit: { type: "number", description: "Number of results (default 5, max 20)" },
        env: { type: "string", enum: ["prod", "sandbox"], description: "Database environment (default: prod)" },
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
        application_id: { type: "string", description: "onboarding_applications.id (UUID)" },
        env: { type: "string", enum: ["prod", "sandbox"], description: "Database environment (default: prod)" },
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
        application_id: { type: "string", description: "onboarding_applications.id (UUID)" },
        env: { type: "string", enum: ["prod", "sandbox"], description: "Database environment (default: prod)" },
      },
      required: ["application_id"],
    },
  },
  {
    name: "db_get_vouched_results",
    description:
      "Get Vouched document-verification job results for an application. Returns job status and result. Used for the older Vouched IDV flow (Plaid IDV results live in coadmin_get_plaid_idv_documents).",
    inputSchema: {
      type: "object",
      properties: {
        application_id: { type: "string", description: "onboarding_applications.id (UUID)" },
        env: { type: "string", enum: ["prod", "sandbox"], description: "Database environment (default: prod)" },
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
        application_id: { type: "string", description: "onboarding_applications.id (UUID)" },
        env: { type: "string", enum: ["prod", "sandbox"], description: "Database environment (default: prod)" },
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
        env: { type: "string", enum: ["prod", "sandbox"], description: "Database environment (default: prod)" },
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
        env: { type: "string", enum: ["prod", "sandbox"], description: "Database environment (default: sandbox)" },
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
        fi_id: { type: "string", description: "financial_institutions.id (UUID)" },
        env: { type: "string", enum: ["prod", "sandbox"], description: "Database environment (default: sandbox)" },
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
        fi_product_id: { type: "string", description: "financial_institution_products.id (UUID)" },
        env: { type: "string", enum: ["prod", "sandbox"], description: "Database environment (default: sandbox)" },
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
        fi_id: { type: "string", description: "financial_institutions.id (UUID)" },
        env: { type: "string", enum: ["prod", "sandbox"], description: "Database environment (default: sandbox)" },
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
        name: { type: "string", description: "Financial institution name or partial name" },
        env: { type: "string", enum: ["prod", "sandbox"], description: "Database environment (default: sandbox)" },
      },
      required: ["name"],
    },
  },
];
