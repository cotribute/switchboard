import { Pool } from "pg";
import {
  SQL_PRODUCT_OVERVIEW,
  SQL_DECISION_DISTRIBUTION,
  SQL_FLOW_BREAKDOWN,
  SQL_RISK_SIGNALS_VIA_APPS,
  SQL_FIS_GKYC,
  SQL_OFAC,
  SQL_DECISION_AUTOMATION,
  SQL_TIME_TO_DECISION,
  SQL_UNIQUE_USERS,
  SQL_MONTHLY_TREND,
  SQL_LOAN_DOLLARS,
} from "./business-outcomes-sql.js";
import {
  SQL_FGP_DEMO_FI_IDS,
  SQL_FGP_EFFECTIV_CANDIDATES,
  SQL_FGP_PLAID_DOCUMENT_CANDIDATES,
  SQL_FGP_PLAID_INITIATION_CANDIDATES,
  SQL_FGP_SESSION_INITIATIONS_EXISTS,
  SQL_FGP_RESOLVE_FI_BY_UUID,
  SQL_FGP_RESOLVE_FI_BY_TEXT,
} from "./fgp-utilization-sql.js";
import {
  computeFgpUtilization,
  EffectivCandidate,
  PlaidCandidate,
} from "./fgp-utilization.js";

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

    // ── Legacy bridge ────────────────────────────────────────────────────

    db_lookup_organization_for_fi: async (args) => {
      // organizations.meta is a `json` column (not jsonb); ->> still works.
      const { rows } = await pool(args.env, "prod").query(
        `SELECT id, name, slug, created_at, updated_at
         FROM organizations
         WHERE meta->>'financialInstitutionId' = $1
         ORDER BY created_at DESC LIMIT 5`,
        [args.fi_id]
      );
      return rows;
    },

    db_get_submission_application: async (args) => {
      const { rows } = await pool(args.env, "prod").query(
        `SELECT s.id AS submission_id, s.organization_id, s.user_id,
                s.form_id, s.category, s.status, s.created_at, s.updated_at,
                s.onboarding_application_id,
                oa.status AS app_status, oa.flow_id, oa.financial_user_id,
                oa.created_at AS app_created_at, oa.updated_at AS app_updated_at
         FROM submissions s
         LEFT JOIN onboarding_applications oa ON oa.id = s.onboarding_application_id
         WHERE s.id = $1
         LIMIT 1`,
        [args.submission_id]
      );
      return rows[0] ?? null;
    },

    // ── Application underwriting ─────────────────────────────────────────

    db_get_application_financial_application: async (args) => {
      const { rows } = await pool(args.env, "prod").query(
        `SELECT uuid, financial_institution_id, applicant_uuid, co_applicant_uuid,
                share_product_uuid, share_product_rate_uuid, financial_business_uuid,
                opening_deposit, loan_amount, desired_monthly_payment,
                loan_credit_limit, loan_payment_frequency, loan_payment_term,
                created_at, updated_at
         FROM financial_applications
         WHERE onboarding_application_id = $1
           AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT 5`,
        [args.application_id]
      );
      return rows;
    },

    db_get_watchlist_results: async (args) => {
      // Two sequential queries: orders+reports first, then hits keyed by the
      // returned report uuids. Sequential to stay within the 3-conn pool.
      const p = pool(args.env, "prod");
      const orders = await p.query(
        `SELECT o.uuid AS order_uuid, o.scope, o.subject, o.aliases,
                o.created_at AS order_created_at,
                r.uuid AS report_uuid, r.type AS report_type,
                r.created_at AS report_created_at
         FROM financial_application_watchlist_orders o
         JOIN financial_applications fa ON fa.uuid = o.financial_application_uuid
         LEFT JOIN financial_application_watchlist_reports r
           ON r.financial_application_watchlist_order_uuid = o.uuid
              AND r.deleted_at IS NULL
         WHERE fa.onboarding_application_id = $1
           AND o.deleted_at IS NULL
         ORDER BY o.created_at DESC, r.created_at DESC
         LIMIT 50`,
        [args.application_id]
      );
      const reportUuids = Array.from(
        new Set(
          orders.rows
            .map((r: any) => r.report_uuid)
            .filter((u: any) => u !== null)
        )
      );
      const hits =
        reportUuids.length === 0
          ? { rows: [] }
          : await p.query(
              `SELECT financial_application_watchlist_report_uuid AS report_uuid,
                      uuid AS hit_uuid, description, score_percent, data, created_at
               FROM financial_application_watchlist_hits
               WHERE financial_application_watchlist_report_uuid = ANY($1::uuid[])
                 AND deleted_at IS NULL
               ORDER BY score_percent DESC NULLS LAST, created_at DESC
               LIMIT 200`,
              [reportUuids]
            );
      return { orders: orders.rows, hits: hits.rows };
    },

    db_get_credit_report: async (args) => {
      // Two sequential queries; encrypted_* columns intentionally excluded —
      // the raw report bodies are decrypted via coadmin-api, not here.
      const p = pool(args.env, "prod");
      const reports = await p.query(
        `SELECT cr.uuid, cr.scope, cr.bureau, cr.product,
                cr.received_at, cr.created_at, cr.updated_at, cr.idempotency_key
         FROM financial_application_credit_reports cr
         JOIN financial_applications fa ON fa.uuid = cr.financial_application_uuid
         WHERE fa.onboarding_application_id = $1
           AND cr.deleted_at IS NULL
         ORDER BY cr.created_at DESC LIMIT 20`,
        [args.application_id]
      );
      const pulls = await p.query(
        `SELECT cp.uuid, cp.core_banking_request_log_uuid, cp.type_serial,
                cp.primary_person_serial, cp.secondary_person_serial,
                cp.credit_pull_user_serial, cp.credit_pull_serial,
                cp.status, cp.error, cp.created_at, cp.updated_at
         FROM corelation_credit_pulls cp
         JOIN financial_applications fa ON fa.uuid = cp.financial_application_uuid
         WHERE fa.onboarding_application_id = $1
           AND cp.deleted_at IS NULL
         ORDER BY cp.created_at DESC LIMIT 20`,
        [args.application_id]
      );
      return { credit_reports: reports.rows, corelation_pulls: pulls.rows };
    },

    db_get_business_verification: async (args) => {
      // Sequential. middesk_objects.external_id is text holding the
      // onboarding_application_id; fis_product_evaluations joins through
      // fis_gkyc_evaluations to reach the application.
      const p = pool(args.env, "prod");
      const middesk = await p.query(
        `SELECT uuid, object, id AS middesk_id, external_id,
                data->>'status' AS status,
                data->'name' AS name,
                data->'tin' AS tin_obj,
                data->'review' AS review,
                created_at, updated_at
         FROM middesk_objects
         WHERE external_id = $1
           AND deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT 10`,
        [args.application_id]
      );
      const fisProduct = await p.query(
        `SELECT fpe.uuid, fpe.product, fpe.result, fpe."order",
                fpe.details, fpe.errors,
                fpe.created_at, fpe.updated_at
         FROM fis_product_evaluations fpe
         JOIN fis_gkyc_evaluations fge ON fge.uuid = fpe.fis_gkyc_evaluation_uuid
         WHERE fge.onboarding_application_id = $1
           AND fpe.deleted_at IS NULL
         ORDER BY fpe.created_at DESC LIMIT 20`,
        [args.application_id]
      );
      return {
        middesk_objects: middesk.rows,
        fis_product_evaluations: fisProduct.rows,
      };
    },

    // ── Flow internals ───────────────────────────────────────────────────

    db_get_flow_actions: async (args) => {
      const { rows } = await pool(args.env, "sandbox").query(
        `SELECT fac.uuid, fac.title, fac.trigger, fac.handler,
                fac.sort_order, fac.settings, fac.conditions,
                fac.created_at, fac.updated_at,
                ftc.uuid AS transform_uuid, ftc.transform_key,
                ftc.settings AS transform_settings
         FROM flow_action_configurations fac
         LEFT JOIN flow_transform_configurations ftc
           ON ftc.uuid = fac.flow_transform_configuration_uuid
              AND ftc.deleted_at IS NULL
         WHERE fac.flow_id = $1
           AND fac.deleted_at IS NULL
         ORDER BY fac.sort_order ASC, fac.created_at ASC
         LIMIT 100`,
        [args.flow_id]
      );
      return rows;
    },

    db_get_flow_routing: async (args) => {
      // Two sequential queries — both keyed by flow_id.
      const p = pool(args.env, "sandbox");
      const transitions = await p.query(
        `SELECT uuid, step_slug, next_step_slug, title,
                conditions, execution_order, created_at, updated_at
         FROM flow_transition_rules
         WHERE flow_id = $1
           AND deleted_at IS NULL
         ORDER BY step_slug, execution_order ASC
         LIMIT 200`,
        [args.flow_id]
      );
      const prefills = await p.query(
        `SELECT uuid, request_domain,
                success_redirect_base_url, error_redirect_base_url,
                completion_redirect_base_url,
                field_mappings, created_at, updated_at
         FROM prefill_templates
         WHERE flow_id = $1
           AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT 20`,
        [args.flow_id]
      );
      return {
        transition_rules: transitions.rows,
        prefill_templates: prefills.rows,
      };
    },

    db_get_flow_offers: async (args) => {
      // flow_offers.flow_id is text (legacy schema choice), so we cast.
      const { rows } = await pool(args.env, "sandbox").query(
        `SELECT fo.uuid, fo.slug, fo.display_order, fo.conditions, fo.meta,
                fo.created_at, fo.updated_at,
                sp.uuid AS share_product_uuid, sp.slug AS share_product_slug,
                sp.title AS share_product_title
         FROM flow_offers fo
         LEFT JOIN share_products sp ON sp.uuid = fo.share_product_uuid
           AND sp.deleted_at IS NULL
         WHERE fo.flow_id = $1::text
           AND fo.deleted_at IS NULL
         ORDER BY fo.display_order ASC NULLS LAST, fo.created_at ASC
         LIMIT 100`,
        [args.flow_id]
      );
      return rows;
    },

    // ── Product / decisioning config ─────────────────────────────────────

    db_get_decision_statuses: async (args) => {
      const { rows } = await pool(args.env, "sandbox").query(
        `SELECT uuid, slug, title, sort_order, decision, locked,
                suppress_reminder_notifications, created_at, updated_at
         FROM decision_statuses
         WHERE financial_institution_product_id = $1
           AND deleted_at IS NULL
         ORDER BY sort_order ASC, title ASC
         LIMIT 100`,
        [args.fi_product_id]
      );
      return rows;
    },

    db_get_fi_share_products: async (args) => {
      const { rows } = await pool(args.env, "sandbox").query(
        `SELECT sp.uuid, sp.slug, sp.title, sp.description,
                sp.minimum_opening_deposit, sp.maximum_opening_deposit,
                sp.maturity_period, sp.maturity_period_units,
                sp.compound_frequency, sp.sort_order,
                sp.visibility_conditions, sp.external_id,
                sp.created_at, sp.updated_at,
                sc.uuid AS category_uuid, sc.slug AS category_slug,
                sc.title AS category_title
         FROM share_products sp
         JOIN share_categories sc ON sc.uuid = sp.share_category_uuid
         WHERE sp.financial_institution_id = $1
           AND sp.deleted_at IS NULL
         ORDER BY sc.sort_order ASC NULLS LAST, sc.title ASC,
                  sp.sort_order ASC NULLS LAST, sp.title ASC
         LIMIT 200`,
        [args.fi_id]
      );
      return rows;
    },

    db_get_flow_mapping_templates: async (args) => {
      // flows.settings->'financialApplicationMapping' may be a single object
      // or an array of {templateUUID, partial?, conditions?}. Normalise to
      // an array via jsonb_typeof and CROSS JOIN LATERAL on jsonb_array_elements,
      // then join to financial_application_mapping_templates by uuid.
      const { rows } = await pool(args.env, "sandbox").query(
        `SELECT (elem->>'templateUUID')::uuid AS template_uuid,
                (elem->>'partial')::boolean AS is_partial,
                elem->'conditions' AS conditions,
                fam.slug, fam.template_engine,
                fam.template, fam.answer_mapping_dictionary,
                fam.created_at, fam.updated_at
         FROM flows f
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE
             WHEN jsonb_typeof(f.settings->'financialApplicationMapping') = 'array'
               THEN f.settings->'financialApplicationMapping'
             WHEN jsonb_typeof(f.settings->'financialApplicationMapping') = 'object'
               THEN jsonb_build_array(f.settings->'financialApplicationMapping')
             ELSE '[]'::jsonb
           END
         ) AS elem
         LEFT JOIN financial_application_mapping_templates fam
           ON fam.uuid = (elem->>'templateUUID')::uuid
         WHERE f.id = $1
         LIMIT 20`,
        [args.flow_id]
      );
      return rows;
    },

    // ── Core banking config ──────────────────────────────────────────────

    db_get_core_banking_config: async (args) => {
      const { rows } = await pool(args.env, "sandbox").query(
        `SELECT cbc.uuid, cbc.description,
                cba.slug AS adapter_slug, cba.description AS adapter_description,
                cbc.core_banking_credential_uuid IS NOT NULL AS has_credentials,
                cbc.created_at, cbc.updated_at
         FROM core_banking_configurations cbc
         JOIN core_banking_adapters cba ON cba.uuid = cbc.core_banking_adapter_uuid
         WHERE cbc.financial_institution_id = $1
         ORDER BY cba.slug ASC, cbc.updated_at DESC
         LIMIT 100`,
        [args.fi_id]
      );
      return rows;
    },

    db_get_core_banking_config_detail: async (args) => {
      // Sequential — config + per-adapter decision-status mappings keyed
      // off this config's uuid. The three mapping tables are disjoint by
      // adapter (corelation links via adapter id directly, symitar+sync1 link
      // via core_banking_configuration_uuid). All three checked in parallel
      // would burn 3 of 3 pool slots — keep sequential.
      const p = pool(args.env, "sandbox");
      const config = await p.query(
        `SELECT cbc.uuid, cbc.description,
                cbc.settings, cbc.field_mappings,
                cbc.financial_institution_id,
                cba.uuid AS adapter_uuid, cba.slug AS adapter_slug,
                cba.description AS adapter_description, cba.settings AS adapter_default_settings,
                cbc.core_banking_credential_uuid IS NOT NULL AS has_credentials,
                cbc.created_at, cbc.updated_at
         FROM core_banking_configurations cbc
         JOIN core_banking_adapters cba ON cba.uuid = cbc.core_banking_adapter_uuid
         WHERE cbc.uuid = $1`,
        [args.config_id]
      );
      const configRow = config.rows[0] ?? null;
      if (!configRow) return null;
      const symitar = await p.query(
        `SELECT uuid, financial_institution_product_id, flow_id,
                decision_status_uuid, lookback_period_in_days,
                archive_aged_applications, mappings,
                created_at, updated_at
         FROM symitar_decision_status_mappings
         WHERE core_banking_configuration_uuid = $1
           AND deleted_at IS NULL`,
        [args.config_id]
      );
      const sync1 = await p.query(
        `SELECT uuid, financial_institution_product_id, flow_id,
                decision_status_uuid, lookback_period_in_days,
                archive_aged_applications, mappings,
                created_at, updated_at
         FROM sync1_decision_status_mappings
         WHERE core_banking_configuration_uuid = $1
           AND deleted_at IS NULL`,
        [args.config_id]
      );
      // corelation mappings are keyed by adapter, not configuration —
      // include them when the adapter is corelation so the picture is complete.
      let corelation: { rows: any[] } = { rows: [] };
      if (configRow.adapter_slug === "corelation") {
        corelation = await p.query(
          `SELECT uuid, financial_institution_product_id, flow_id,
                  decision_status_uuid, lookback_period_in_days,
                  archive_aged_applications, mappings,
                  created_at, updated_at
           FROM corelation_decision_status_mappings
           WHERE deleted_at IS NULL
           LIMIT 200`
        );
      }
      return {
        configuration: configRow,
        symitar_decision_status_mappings: symitar.rows,
        sync1_decision_status_mappings: sync1.rows,
        corelation_decision_status_mappings: corelation.rows,
      };
    },

    // ── Cowork-skill battery (default env: "prod") ────────────────────────
    //
    // Powers the `/generate-business-outcomes` Cowork skill. Runs the same
    // 10-query battery the dreambigger Claude Code skill uses (verbatim SQL)
    // in a single round-trip so Cowork doesn't pay a per-query LLM hop.

    db_business_outcomes_battery: async (args) => {
      const p = pool(args.env, "prod");
      const endDate =
        args.end_date && /^\d{4}-\d{2}-\d{2}$/.test(args.end_date)
          ? args.end_date
          : new Date().toISOString().slice(0, 10);

      // Step 1 — Resolve the FI.
      const raw = String(args.fi_query ?? "").trim();
      if (!raw) {
        return { ok: false, error: "fi_query is required." };
      }
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          raw
        );
      const fiSql = isUuid
        ? `SELECT id, name, slug, meta
             FROM financial_institutions
             WHERE id = $1`
        : `SELECT id, name, slug, meta
             FROM financial_institutions
             WHERE name ILIKE $1 OR slug ILIKE $1
             ORDER BY name
             LIMIT 10`;
      const fiParam = isUuid ? raw : `%${raw}%`;
      const fiResult = await p.query(fiSql, [fiParam]);
      if (fiResult.rows.length === 0) {
        return { ok: false, error: `No financial institution matched "${raw}".` };
      }
      if (fiResult.rows.length > 1) {
        return {
          ambiguous: true,
          candidates: fiResult.rows.map((r: any) => ({
            id: r.id,
            name: r.name,
            slug: r.slug,
          })),
        };
      }

      const fi = fiResult.rows[0];
      const fiId: string = fi.id;
      const brand: any = fi.meta?.skins?.[0]?.brand ?? {};

      // Step 2 — Run the 10 battery queries in parallel.
      const [
        productOverview,
        decisionDistribution,
        flowBreakdown,
        riskSignalsApps,
        fisGkyc,
        ofac,
        decisionAutomation,
        timeToDecision,
        uniqueUsers,
        monthlyTrend,
        loanDollars,
      ] = await Promise.all([
        p.query(SQL_PRODUCT_OVERVIEW, [fiId]),
        p.query(SQL_DECISION_DISTRIBUTION, [fiId]),
        p.query(SQL_FLOW_BREAKDOWN, [fiId]),
        p.query(SQL_RISK_SIGNALS_VIA_APPS, [fiId, endDate]),
        p.query(SQL_FIS_GKYC, [fiId, endDate]),
        p.query(SQL_OFAC, [fiId]),
        p.query(SQL_DECISION_AUTOMATION, [fiId]),
        p.query(SQL_TIME_TO_DECISION, [fiId]),
        p.query(SQL_UNIQUE_USERS, [fiId]),
        p.query(SQL_MONTHLY_TREND, [fiId]),
        p.query(SQL_LOAN_DOLLARS, [fiId]),
      ]);

      return {
        ok: true,
        fi: {
          id: fi.id,
          name: fi.name,
          slug: fi.slug,
          brand: {
            primary_color: brand.primaryColor ?? null,
            secondary_color: brand.secondaryColor ?? null,
            primary_logo: brand.primaryLogo ?? null,
          },
        },
        end_date: endDate,
        product_overview: productOverview.rows,
        decision_distribution: decisionDistribution.rows,
        flow_breakdown: flowBreakdown.rows,
        risk_signals: {
          ...(riskSignalsApps.rows[0] ?? {}),
          ...(fisGkyc.rows[0] ?? {}),
        },
        ofac: ofac.rows[0] ?? null,
        decision_automation: decisionAutomation.rows,
        time_to_decision: timeToDecision.rows,
        unique_users: uniqueUsers.rows[0] ?? null,
        monthly_trend: monthlyTrend.rows,
        loan_dollars: loanDollars.rows,
      };
    },

    // ── FraudGuard+ utilization battery (default env: "prod") ─────────────
    //
    // Powers the /generate-fgp-utilization Cowork skill. Fetches lean Effectiv +
    // Plaid IDV candidate rows for a date window, dedupes them per applicant
    // (Effectiv OR Plaid OR both for one person = 1 billable inquiry), and
    // returns compact per-FI billable/non-billable aggregates. Per-applicant
    // detail is returned only on a single-FI drill-down (include_detail).

    db_fgp_utilization_battery: async (args) => {
      const p = pool(args.env, "prod");

      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      const startDate = String(args.start_date ?? "").trim();
      const endDate = String(args.end_date ?? "").trim();
      if (!dateRe.test(startDate) || !dateRe.test(endDate)) {
        return {
          ok: false,
          error:
            "start_date and end_date are required as YYYY-MM-DD (end_date exclusive).",
        };
      }
      if (startDate >= endDate) {
        return { ok: false, error: "start_date must be before end_date." };
      }

      // Optional FI filter — resolve to a single FI id, or report ambiguity.
      let fiFilter: { id: string; name: string; slug: string } | null = null;
      const rawFi = String(args.fi_query ?? "").trim();
      if (rawFi) {
        const isUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            rawFi
          );
        const fiRes = isUuid
          ? await p.query(SQL_FGP_RESOLVE_FI_BY_UUID, [rawFi])
          : await p.query(SQL_FGP_RESOLVE_FI_BY_TEXT, [`%${rawFi}%`]);
        if (fiRes.rows.length === 0) {
          return { ok: false, error: `No financial institution matched "${rawFi}".` };
        }
        if (fiRes.rows.length > 1) {
          return {
            ambiguous: true,
            candidates: fiRes.rows.map((r: any) => ({
              id: r.id,
              name: r.name,
              slug: r.slug,
            })),
          };
        }
        fiFilter = fiRes.rows[0];
      }

      const fiIdParam = fiFilter ? fiFilter.id : null;

      // Does the session-initiations table exist yet? (Added by a dreambigger
      // migration; the tool works before and after it ships.)
      const initiationsExist = (
        await p.query(SQL_FGP_SESSION_INITIATIONS_EXISTS)
      ).rows[0]?.exists === true;

      const [demoRes, effectivRes, plaidDocRes, plaidInitRes] =
        await Promise.all([
          p.query(SQL_FGP_DEMO_FI_IDS),
          p.query(SQL_FGP_EFFECTIV_CANDIDATES, [startDate, endDate, fiIdParam]),
          p.query(SQL_FGP_PLAID_DOCUMENT_CANDIDATES, [
            startDate,
            endDate,
            fiIdParam,
          ]),
          initiationsExist
            ? p.query(SQL_FGP_PLAID_INITIATION_CANDIDATES, [
                startDate,
                endDate,
                fiIdParam,
              ])
            : Promise.resolve({ rows: [] as any[] }),
        ]);

      const demoFiIds = new Set<string>(
        demoRes.rows.map((r: any) => String(r.fi_id))
      );

      const effectiv: EffectivCandidate[] = effectivRes.rows.map((r: any) => ({
        uuid: r.uuid,
        app_id: r.app_id,
        fi_id: r.fi_id,
        fi_name: r.fi_name,
        fi_slug: r.fi_slug,
        is_demo: demoFiIds.has(r.fi_id),
        slug: r.slug,
        first_name: r.first_name,
        last_name: r.last_name,
        dob: r.dob,
        ssn_last4: r.ssn_last4 || null,
        reached_fraud_step: r.reached_fraud_step === true,
        decision: r.decision,
        created_at: r.created_at,
      }));

      const plaid: PlaidCandidate[] = [
        ...plaidDocRes.rows,
        ...plaidInitRes.rows,
      ].map((r: any) => ({
        uuid: r.uuid,
        app_id: r.app_id,
        fi_id: r.fi_id,
        fi_name: r.fi_name,
        fi_slug: r.fi_slug,
        is_demo: demoFiIds.has(r.fi_id),
        slug: r.slug,
        first_name: r.first_name,
        last_name: r.last_name,
        dob: r.dob,
        status: r.status,
        document_status: r.document_status ?? null,
        identity_verification_id: r.identity_verification_id ?? null,
        source: r.source,
        created_at: r.created_at,
      }));

      const includeDetail = args.include_detail === true && fiFilter !== null;
      const result = computeFgpUtilization(effectiv, plaid, { includeDetail });

      return {
        ok: true,
        window: { start_date: startDate, end_date: endDate },
        fi_filter: fiFilter,
        session_initiations_available: initiationsExist,
        notes: [
          "Billable unit = (application, person). Effectiv OR Plaid (OR both) for one person = 1 inquiry.",
          "Person key = normalized firstName|lastName|dob (Plaid has no SSN; slug 'govt-id' is not per-person).",
          initiationsExist
            ? "Plaid abandoned/email session initiations included from financial_plaid_idv_session_initiations."
            : "Plaid abandoned/email sessions NOT yet captured (session-initiations table not deployed); historical Plaid counts derive from completed documents only and may undercount vs. the Plaid dashboard.",
          "effectiv_calls / plaid_calls are raw vendor charge counts (cost side); billable_inquiries is the client-billed (revenue) side.",
        ],
        ...result,
      };
    },
  };
}
