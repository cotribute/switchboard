import { Pool } from "pg";

export function createHandlers(
  prodPool: Pool | null,
  uatPool: Pool | null
): Record<string, (args: any) => Promise<any>> {
  function pool(env: string | undefined, configDefault: "prod" | "sandbox" = "prod"): Pool {
    const effective = env ?? configDefault;
    const p = effective === "sandbox" ? uatPool : prodPool;
    if (!p) throw new Error(`No database pool configured for env: ${effective}`);
    return p;
  }

  return {
    // ── Transaction tools (default env: "prod") ──────────────────────────

    db_lookup_user: async (args) => {
      const { rows } = await pool(args.env, "prod").query(
        `SELECT fu.id AS user_id, fu.email, fu.created_at, fu.updated_at,
                fi.id AS fi_id, fi.name AS fi_name
         FROM financial_users fu
         JOIN financial_institutions fi ON fi.id = fu.financial_institution_id
         WHERE fu.email = $1 LIMIT 5`,
        [args.email]
      );
      return rows;
    },

    db_get_recent_applications: async (args) => {
      const limit = Math.min(args.limit ?? 5, 20);
      const { rows } = await pool(args.env, "prod").query(
        `SELECT oa.id, oa.status, oa.current_slug, oa.created_at, oa.updated_at,
                ds.name AS decision_status, f.name AS flow_name
         FROM onboarding_applications oa
         LEFT JOIN decision_statuses ds ON ds.id = oa.decision_status_id
         LEFT JOIN flows f ON f.id = oa.flow_id
         WHERE oa.financial_user_id = $1
         ORDER BY oa.updated_at DESC LIMIT $2`,
        [args.user_id, limit]
      );
      return rows;
    },

    db_get_application_details: async (args) => {
      const { rows } = await pool(args.env, "prod").query(
        `SELECT oa.id, oa.status, oa.current_slug, oa.created_at, oa.updated_at,
                ds.name AS decision_status, f.name AS flow_name,
                fi.name AS fi_name, fi.id AS fi_id
         FROM onboarding_applications oa
         LEFT JOIN decision_statuses ds ON ds.id = oa.decision_status_id
         LEFT JOIN flows f ON f.id = oa.flow_id
         LEFT JOIN financial_institutions fi ON fi.id = oa.financial_institution_id
         WHERE oa.id = $1`,
        [args.application_id]
      );
      return rows[0] ?? null;
    },

    db_get_fraud_results: async (args) => {
      const { rows } = await pool(args.env, "prod").query(
        `SELECT fafr.created_at, fafr.category, fafr.scope, fafr.risk_score,
                array_agg(far.code ORDER BY far.code) FILTER (WHERE far.code IS NOT NULL) AS reason_codes
         FROM financial_application_fraud_results fafr
         LEFT JOIN financial_application_fraud_reasons far
           ON far.financial_application_fraud_result_uuid = fafr.id
         JOIN financial_applications fa ON fa.id = fafr.financial_application_id
         WHERE fa.onboarding_application_id = $1
         GROUP BY fafr.id ORDER BY fafr.created_at DESC LIMIT 10`,
        [args.application_id]
      );
      return rows;
    },

    db_get_vouched_results: async (args) => {
      const { rows } = await pool(args.env, "prod").query(
        `SELECT created_at, status, result
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
      const p = pool(args.env, "prod");
      const [otp, twilio] = await Promise.all([
        p.query(
          `SELECT created_at, verified_at
           FROM otp_codes
           WHERE financial_user_id = $1
           ORDER BY created_at DESC LIMIT 10`,
          [args.user_id]
        ),
        p.query(
          `SELECT created_at, status, channel, "to"
           FROM twilio_verification_logs
           WHERE financial_user_id = $1
           ORDER BY created_at DESC LIMIT 10`,
          [args.user_id]
        ),
      ]);
      return { otp_codes: otp.rows, twilio_verifications: twilio.rows };
    },

    // ── Config tools (default env: "sandbox") ────────────────────────────

    db_get_flow_config: async (args) => {
      const { rows } = await pool(args.env, "sandbox").query(
        `SELECT f.id, f.name, f.settings, f.updated_at,
                fi.name AS fi_name, fip.name AS product_name
         FROM flows f
         JOIN financial_institution_products fip ON fip.id = f.financial_institution_product_id
         JOIN financial_institutions fi ON fi.id = fip.financial_institution_id
         WHERE f.id = $1`,
        [args.flow_id]
      );
      return rows[0] ?? null;
    },

    db_get_fi_flows: async (args) => {
      const { rows } = await pool(args.env, "sandbox").query(
        `SELECT f.id, f.name, fip.name AS product_name, f.created_at, f.updated_at
         FROM flows f
         JOIN financial_institution_products fip ON fip.id = f.financial_institution_product_id
         WHERE fip.financial_institution_id = $1
         ORDER BY f.updated_at DESC`,
        [args.fi_id]
      );
      return rows;
    },

    db_get_decision_rules: async (args) => {
      const { rows } = await pool(args.env, "sandbox").query(
        `SELECT dr.id, dr.name, dr.conditions, ds.name AS outcome_status,
                dr.created_at, dr.updated_at
         FROM decision_rules dr
         JOIN decision_statuses ds ON ds.id = dr.decision_status_id
         WHERE dr.financial_institution_product_id = $1
         ORDER BY dr.updated_at DESC`,
        [args.fi_product_id]
      );
      return rows;
    },

    db_get_fi_products: async (args) => {
      const { rows } = await pool(args.env, "sandbox").query(
        `SELECT id, name, slug, meta, created_at
         FROM financial_institution_products
         WHERE financial_institution_id = $1
         ORDER BY name`,
        [args.fi_id]
      );
      return rows;
    },

    db_get_fi_by_name: async (args) => {
      const { rows } = await pool(args.env, "sandbox").query(
        `SELECT id, name, created_at FROM financial_institutions
         WHERE name ILIKE $1 LIMIT 10`,
        [`%${args.name}%`]
      );
      return rows;
    },
  };
}
