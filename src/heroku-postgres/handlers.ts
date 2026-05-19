import { Pool } from "pg";

export function createHandlers(
  prodPool: Pool | null,
  uatPool: Pool | null
): Record<string, (args: any) => Promise<any>> {
  function pool(
    env: string | undefined,
    configDefault: "prod" | "sandbox" = "prod"
  ): Pool {
    const effective = env ?? configDefault;
    if (effective !== "prod" && effective !== "sandbox") {
      throw new Error(
        `Invalid env: ${effective}. Must be "prod" or "sandbox".`
      );
    }
    const p = effective === "sandbox" ? uatPool : prodPool;
    if (!p)
      throw new Error(`No database pool configured for env: ${effective}`);
    return p;
  }

  return {
    // ── Transaction tools (default env: "prod") ──────────────────────────

    db_lookup_user: async (args) => {
      // `financial_users` uses (login_id, login_id_type) — no plain `email`
      // column. We don't filter by login_id_type so phone-login users still
      // match; the caller sees the type in the result.
      const { rows } = await pool(args.env, "prod").query(
        `SELECT fu.id AS user_id, fu.login_id, fu.login_id_type,
                fu.first_name, fu.last_name, fu.login_verified,
                fu.created_at, fu.updated_at,
                fi.id AS fi_id, fi.name AS fi_name
         FROM financial_users fu
         JOIN financial_institutions fi ON fi.id = fu.financial_institution_id
         WHERE fu.login_id = $1
         ORDER BY fu.created_at DESC LIMIT 5`,
        [args.email]
      );
      return rows;
    },

    db_get_recent_applications: async (args) => {
      const limit = Math.min(args.limit ?? 5, 20);
      const { rows } = await pool(args.env, "prod").query(
        `SELECT oa.id, oa.status, oa.created_at, oa.updated_at,
                ds.title AS decision_status, f.title AS flow_name
         FROM onboarding_applications oa
         LEFT JOIN decision_statuses ds ON ds.uuid = oa.decision_status_uuid
         LEFT JOIN flows f ON f.id = oa.flow_id
         WHERE oa.financial_user_id = $1
         ORDER BY oa.updated_at DESC LIMIT $2`,
        [args.user_id, limit]
      );
      return rows;
    },

    db_get_application_details: async (args) => {
      // `onboarding_applications` has no direct financial_institution_id;
      // FI is reached via flow → financial_institution_product → FI.
      const { rows } = await pool(args.env, "prod").query(
        `SELECT oa.id, oa.status, oa.created_at, oa.updated_at,
                ds.title AS decision_status,
                f.id AS flow_id, f.title AS flow_name,
                fip.id AS fi_product_id, fip.title AS fi_product_name,
                fi.id AS fi_id, fi.name AS fi_name
         FROM onboarding_applications oa
         LEFT JOIN decision_statuses ds ON ds.uuid = oa.decision_status_uuid
         LEFT JOIN flows f ON f.id = oa.flow_id
         LEFT JOIN financial_institution_products fip
           ON fip.id = f.financial_institution_product_id
         LEFT JOIN financial_institutions fi ON fi.id = fip.financial_institution_id
         WHERE oa.id = $1`,
        [args.application_id]
      );
      return rows[0] ?? null;
    },

    db_get_fraud_results: async (args) => {
      const { rows } = await pool(args.env, "prod").query(
        `SELECT fafr.created_at, fafr.category, fafr.scope, fafr.risk_score, fafr.risk_level,
                array_agg(far.code ORDER BY far.code) FILTER (WHERE far.code IS NOT NULL) AS reason_codes
         FROM financial_application_fraud_results fafr
         LEFT JOIN financial_application_fraud_reasons far
           ON far.financial_application_fraud_result_uuid = fafr.uuid
         JOIN financial_applications fa ON fa.uuid = fafr.financial_application_uuid
         WHERE fa.onboarding_application_id = $1
         GROUP BY fafr.uuid ORDER BY fafr.created_at DESC LIMIT 10`,
        [args.application_id]
      );
      return rows;
    },

    db_get_vouched_results: async (args) => {
      // `vouched_job_results` has no `result` column — useful fields are
      // status, success (boolean), stage, plus the raw vendor payload.
      const { rows } = await pool(args.env, "prod").query(
        `SELECT created_at, status, success, stage
         FROM vouched_job_results
         WHERE onboarding_application_id = $1
         ORDER BY created_at DESC LIMIT 10`,
        [args.application_id]
      );
      return rows;
    },

    db_get_stripe_payments: async (args) => {
      const { rows } = await pool(args.env, "prod").query(
        `SELECT id, status, amount, currency, created_at
         FROM payment_intents
         WHERE entity_type = 'OnboardingApplication' AND entity_id = $1
         ORDER BY created_at DESC LIMIT 10`,
        [args.application_id]
      );
      return rows;
    },

    db_get_otp_history: async (args) => {
      // Sequential — Promise.all would consume 2 of the 3 pool slots per call,
      // saturating the pool under concurrent MCP sessions.
      // `otp_codes` is polymorphic (user_id + user_type); twilio_verification_logs
      // is FK'd directly to financial_users.
      const p = pool(args.env, "prod");
      const otp = await p.query(
        `SELECT created_at, verified_at
         FROM otp_codes
         WHERE user_id = $1 AND user_type = 'FinancialUser'
         ORDER BY created_at DESC LIMIT 10`,
        [args.user_id]
      );
      const twilio = await p.query(
        `SELECT created_at, status, channel, "to"
         FROM twilio_verification_logs
         WHERE financial_user_id = $1
         ORDER BY created_at DESC LIMIT 10`,
        [args.user_id]
      );
      return { otp_codes: otp.rows, twilio_verifications: twilio.rows };
    },

    // ── Config tools (default env: "sandbox") ────────────────────────────

    db_get_flow_config: async (args) => {
      const { rows } = await pool(args.env, "sandbox").query(
        `SELECT f.id, f.title AS name, f.slug, f.status, f.settings, f.updated_at,
                fi.name AS fi_name, fip.title AS product_name
         FROM flows f
         JOIN financial_institution_products fip
           ON fip.id = f.financial_institution_product_id
         JOIN financial_institutions fi ON fi.id = fip.financial_institution_id
         WHERE f.id = $1`,
        [args.flow_id]
      );
      return rows[0] ?? null;
    },

    db_get_fi_flows: async (args) => {
      const { rows } = await pool(args.env, "sandbox").query(
        `SELECT f.id, f.title AS name, f.slug, f.status,
                fip.title AS product_name,
                f.created_at, f.updated_at
         FROM flows f
         JOIN financial_institution_products fip
           ON fip.id = f.financial_institution_product_id
         WHERE fip.financial_institution_id = $1
         ORDER BY f.updated_at DESC`,
        [args.fi_id]
      );
      return rows;
    },

    db_get_decision_rules: async (args) => {
      const { rows } = await pool(args.env, "sandbox").query(
        `SELECT dr.uuid AS id, dr.title AS name, dr.slug,
                dr.conditions, dr.execution_order,
                ds.title AS outcome_status,
                dr.created_at, dr.updated_at
         FROM decision_rules dr
         JOIN decision_statuses ds ON ds.uuid = dr.decision_status_uuid
         WHERE dr.financial_institution_product_id = $1
           AND dr.deleted_at IS NULL
         ORDER BY dr.execution_order ASC, dr.updated_at DESC`,
        [args.fi_product_id]
      );
      return rows;
    },

    db_get_fi_products: async (args) => {
      const { rows } = await pool(args.env, "sandbox").query(
        `SELECT id, title AS name, slug, meta, created_at
         FROM financial_institution_products
         WHERE financial_institution_id = $1
         ORDER BY title`,
        [args.fi_id]
      );
      return rows;
    },

    db_get_fi_by_name: async (args) => {
      // % and _ in args.name are treated as ILIKE wildcards. Acceptable for an
      // internal lookup; SQL injection isn't possible since the value is bound.
      const { rows } = await pool(args.env, "sandbox").query(
        `SELECT id, name, created_at FROM financial_institutions
         WHERE name ILIKE $1 LIMIT 10`,
        [`%${args.name}%`]
      );
      return rows;
    },
  };
}
