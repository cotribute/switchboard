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
  SQL_FGP_PLAID_SESSION_CANDIDATES,
  SQL_FGP_LIGHTNING_TEMPLATE_IDS,
  SQL_FGP_SESSIONS_EXISTS,
} from "./fgp-utilization-sql.js";
import {
  SQL_CUSTOMER_USERS,
  SQL_KNOWN_ROLE_NAMES,
} from "./customer-users-sql.js";
import {
  CUSTOMER_USER_COLUMNS,
  CustomerUserRow,
  dedupeByEmail,
  toCsv,
} from "./customer-users.js";
import {
  computeFgpUtilization,
  EffectivCandidate,
  PlaidCandidate,
} from "./fgp-utilization.js";
import {
  SQL_AUDIT_TABLES_EXIST,
  SQL_AUDIT_COVERAGE,
  SQL_CONFIG_AUDIT_SEARCH,
  SQL_CONFIG_AUDIT_COVERAGE,
  SQL_CONFIG_AUDIT_CHANGED_KEYS,
  SQL_CONFIG_AUDIT_DETAIL_INTERNAL,
  SQL_CONFIG_AUDIT_DETAIL_PORTAL,
  SQL_AUDIT_ACTORS_INTERNAL,
  SQL_AUDIT_ACTORS_PORTAL,
  SQL_RESOLVE_ACTOR,
  SQL_SYSADMIN_EMAILS,
  SQL_FUAL_NULL_ITEM_UUID,
  DEFAULT_EXCLUDED_ITEM_TYPES,
  NO_FI_ITEM_TYPES,
  SYSADMIN_PERMISSION_GROUP,
} from "./config-audit-sql.js";
import {
  AuditRow,
  ActorRef,
  ActorKind,
  rollupSessions,
  summarize,
  actorKey,
  changeKey,
  flagCrossTrailDupes,
  renderChanges,
  nameFromEmail,
  actorKeyOf,
} from "./config-audit.js";

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

  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /**
   * Resolve an FI name fragment / slug / uuid to exactly one row, using the
   * established response idioms: { ok: false, error } when nothing matched and
   * { ambiguous: true, candidates } when several did. Returns { fi } on a hit.
   */
  async function resolveFi(
    p: Pool,
    raw: string
  ): Promise<
    | { fi: any }
    | { ok: false; error: string }
    | { ambiguous: true; candidates: any[] }
  > {
    const isUuid = UUID_RE.test(raw);
    const sql = isUuid
      ? `SELECT id, name, slug, meta FROM financial_institutions WHERE id = $1`
      : `SELECT id, name, slug, meta
           FROM financial_institutions
          WHERE name ILIKE $1 OR slug ILIKE $1
          ORDER BY name
          LIMIT 10`;
    const res = await p.query(sql, [isUuid ? raw : `%${raw}%`]);
    if (res.rows.length === 0) {
      return { ok: false, error: `No financial institution matched "${raw}".` };
    }
    if (res.rows.length > 1) {
      return {
        ambiguous: true,
        candidates: res.rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
        })),
      };
    }
    return { fi: res.rows[0] };
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

    db_list_customer_users: async (args) => {
      const p = pool(args.env, "prod");

      let fi: any = null;
      if (args.fi_query) {
        const resolved = await resolveFi(p, String(args.fi_query));
        // Pass the not-found / ambiguous shapes straight through.
        if (!("fi" in resolved)) return resolved;
        fi = resolved.fi;
      }

      let roles: string[] | null = null;
      if (args.roles !== undefined && args.roles !== null) {
        if (!Array.isArray(args.roles)) {
          return {
            ok: false,
            error: "`roles` must be an array of role names.",
          };
        }
        roles = args.roles
          .map((r: unknown) => String(r).trim())
          .filter(Boolean);
        if (roles.length === 0) roles = null;
      }
      if (roles) {
        // Reject typos loudly — an unknown role name would otherwise return an
        // empty list that reads as "nobody has this role".
        const known = (await p.query(SQL_KNOWN_ROLE_NAMES)).rows.map(
          (r: any) => r.name
        );
        const unknown = roles.filter((r) => !known.includes(r));
        if (unknown.length) {
          return {
            ok: false,
            error: `Unknown role name(s): ${unknown.join(", ")}. Known roles: ${known.join(", ")}.`,
          };
        }
      }

      const verifiedOnly = args.verified_only === true;
      const excludeInternal = args.exclude_internal === true;
      const dedupe = args.dedupe_by_email === true;
      // No limit unless asked; MAX_CUSTOMER_USER_ROWS is the backstop below.
      const limit =
        args.limit === undefined || args.limit === null
          ? null
          : clampInt(
              args.limit,
              MAX_CUSTOMER_USER_ROWS,
              1,
              MAX_CUSTOMER_USER_ROWS
            );

      const { rows } = await p.query(SQL_CUSTOMER_USERS, [
        fi?.id ?? null,
        roles,
        verifiedOnly,
        excludeInternal,
        // Fetch one past the cap when unlimited, so truncation is detectable.
        limit ?? MAX_CUSTOMER_USER_ROWS + 1,
      ]);

      // The role predicate normally holds this to ~1.4k rows out of 433k
      // financial_users. If it ever stops doing so, truncate rather than hand
      // the model a context-blowing payload.
      let truncated = rows.length > MAX_CUSTOMER_USER_ROWS;
      let kept: CustomerUserRow[] = truncated
        ? rows.slice(0, MAX_CUSTOMER_USER_ROWS)
        : rows;

      if (dedupe) kept = dedupeByEmail(kept);

      const build = (list: CustomerUserRow[], wasTruncated: boolean) => {
        const byFi = new Map<string, number>();
        for (const r of list) {
          // A deduped row can span FIs (slug list) — count it under each.
          for (const slug of (r.fi_slug ?? "(none)").split(";")) {
            byFi.set(slug, (byFi.get(slug) ?? 0) + 1);
          }
        }
        const result: Record<string, unknown> = {
          ok: true,
          generated_at: new Date().toISOString().slice(0, 10),
          fi: fi ? { id: fi.id, name: fi.name, slug: fi.slug } : null,
          filters_applied: {
            fi_query: args.fi_query ?? null,
            roles,
            verified_only: verifiedOnly,
            exclude_internal: excludeInternal,
            dedupe_by_email: dedupe,
            limit,
          },
          total: list.length,
          columns: CUSTOMER_USER_COLUMNS,
          by_fi: [...byFi.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([fi_slug, users]) => ({ fi_slug, users })),
          rows_csv: toCsv(CUSTOMER_USER_COLUMNS, list as any),
          truncated: wasTruncated,
        };
        if (wasTruncated) {
          result.note =
            `Truncated to ${list.length} rows. Narrow with fi_query or roles, ` +
            `or pass a smaller limit, to get a complete list.`;
        }
        return result;
      };

      // Measure the pretty-printed size, because that is exactly what
      // server.ts sends to the model (JSON.stringify(result, null, 2)).
      let result = build(kept, truncated);
      while (
        kept.length > 1 &&
        JSON.stringify(result, null, 2).length > MAX_CUSTOMER_USER_BYTES
      ) {
        kept = kept.slice(0, Math.floor(kept.length / 2));
        truncated = true;
        result = build(kept, truncated);
      }
      return result;
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
        return {
          ok: false,
          error: `No financial institution matched "${raw}".`,
        };
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
        const resolved = await resolveFi(p, rawFi);
        if (!("fi" in resolved)) return resolved;
        fiFilter = resolved.fi;
      }

      const fiIdParam = fiFilter ? fiFilter.id : null;

      // Does the sessions table exist yet? (Added by a dreambigger migration;
      // the tool works before and after it ships.)
      const sessionsTableExists =
        (await p.query(SQL_FGP_SESSIONS_EXISTS)).rows[0]?.exists === true;

      // Plaid source: prefer the sessions system-of-truth (one row per session,
      // with raw PII + the "something ran" billable filter + UTC bounds, applied
      // in SQL). Fall back to completed documents only when the table isn't
      // deployed yet (pre-backfill) — that under-counts abandoned/Lightning
      // sessions but is the best available.
      const [demoRes, effectivRes, plaidRes, lightningRes] = await Promise.all([
        p.query(SQL_FGP_DEMO_FI_IDS),
        p.query(SQL_FGP_EFFECTIV_CANDIDATES, [startDate, endDate, fiIdParam]),
        sessionsTableExists
          ? p.query(SQL_FGP_PLAID_SESSION_CANDIDATES, [
              startDate,
              endDate,
              fiIdParam,
            ])
          : p.query(SQL_FGP_PLAID_DOCUMENT_CANDIDATES, [
              startDate,
              endDate,
              fiIdParam,
            ]),
        sessionsTableExists
          ? p.query(SQL_FGP_LIGHTNING_TEMPLATE_IDS)
          : Promise.resolve({ rows: [] as { plaid_template_id: string }[] }),
      ]);
      const lightningTemplates = new Set<string>(
        lightningRes.rows.map((r: any) => String(r.plaid_template_id))
      );

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

      const plaid: PlaidCandidate[] = plaidRes.rows.map((r: any) => ({
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
        doc_ran: r.doc_ran === true ? true : r.doc_ran === false ? false : null,
        selfie_ran:
          r.selfie_ran === true ? true : r.selfie_ran === false ? false : null,
        plaid_template_id: r.plaid_template_id ?? null,
      }));

      const includeDetail = args.include_detail === true && fiFilter !== null;
      const result = computeFgpUtilization(effectiv, plaid, {
        includeDetail,
        lightningTemplates,
      });

      // Unit pricing from the FGP Mar 2026 invoice header. Each Effectiv eval
      // triggers all 7 Socure modules, so each module's "qty" equals the
      // effectiv_calls count; only the price differs. Plaid lines bill per
      // session: IV-Base on every billable session, IV-Doc/IV-Selfie when those
      // steps ran, IV-Lightning when the session is on a Lightning template.
      const pricing = {
        socure: {
          m01_eml: 0.0317,
          m02_pho: 0.0317,
          m03_adr: 0.0277,
          m04_fra: 0.1584,
          m05_kyc: 0.1584,
          m06_wl1: 0.0396,
          m17_syn: 0.0554,
        },
        plaid: {
          iv_base: 0.5,
          iv_document: 0.95,
          iv_selfie: 0.23,
          iv_lightning: 0.8,
        },
      } as const;
      const socurePerCall =
        pricing.socure.m01_eml +
        pricing.socure.m02_pho +
        pricing.socure.m03_adr +
        pricing.socure.m04_fra +
        pricing.socure.m05_kyc +
        pricing.socure.m06_wl1 +
        pricing.socure.m17_syn; // $0.5029

      // Enrich each FI row with the cost columns that the spreadsheet renders.
      const summary_by_fi = result.summary_by_fi.map((s) => {
        const socure_subtotal = round2(s.effectiv_calls * socurePerCall);
        const plaid_base_cost = round2(s.plaid_base * pricing.plaid.iv_base);
        const plaid_doc_cost = round2(s.plaid_doc * pricing.plaid.iv_document);
        const plaid_selfie_cost = round2(
          s.plaid_selfie * pricing.plaid.iv_selfie
        );
        const plaid_lightning_cost = round2(
          s.plaid_lightning * pricing.plaid.iv_lightning
        );
        const plaid_subtotal = round2(
          plaid_base_cost +
            plaid_doc_cost +
            plaid_selfie_cost +
            plaid_lightning_cost
        );
        return {
          ...s,
          costs: {
            socure_subtotal,
            plaid_base_cost,
            plaid_doc_cost,
            plaid_selfie_cost,
            plaid_lightning_cost,
            plaid_subtotal,
            grand_total: round2(socure_subtotal + plaid_subtotal),
          },
        };
      });
      const totals_costs = summary_by_fi.reduce(
        (t, s) => {
          t.socure_subtotal = round2(
            t.socure_subtotal + s.costs.socure_subtotal
          );
          t.plaid_base_cost = round2(
            t.plaid_base_cost + s.costs.plaid_base_cost
          );
          t.plaid_doc_cost = round2(t.plaid_doc_cost + s.costs.plaid_doc_cost);
          t.plaid_selfie_cost = round2(
            t.plaid_selfie_cost + s.costs.plaid_selfie_cost
          );
          t.plaid_lightning_cost = round2(
            t.plaid_lightning_cost + s.costs.plaid_lightning_cost
          );
          t.plaid_subtotal = round2(t.plaid_subtotal + s.costs.plaid_subtotal);
          t.grand_total = round2(t.grand_total + s.costs.grand_total);
          return t;
        },
        {
          socure_subtotal: 0,
          plaid_base_cost: 0,
          plaid_doc_cost: 0,
          plaid_selfie_cost: 0,
          plaid_lightning_cost: 0,
          plaid_subtotal: 0,
          grand_total: 0,
        }
      );

      return {
        ok: true,
        window: { start_date: startDate, end_date: endDate },
        fi_filter: fiFilter,
        sessions_available: sessionsTableExists,
        pricing,
        lightning_template_ids: [...lightningTemplates],
        notes: [
          "Billable unit = (application, person). Effectiv OR Plaid (OR both) for one person = 1 inquiry; joint applicants are separate.",
          "Person key = normalized firstName-token|lastName|dob (Plaid has no SSN; slug 'govt-id' is not per-person). Cross-vendor match validated ~99% on a sample FI.",
          "Plaid billable = a session where a verification step ran (data-source/KYC OR document OR selfie) — Plaid's IV-Base trigger. UTC calendar month. Reconciled to the Plaid invoice within ~0.04% on a sample FI; residual is created-vs-charge timing on incomplete sessions.",
          sessionsTableExists
            ? "Plaid sourced from financial_plaid_idv_sessions (system of truth: completed + abandoned + email/shareable)."
            : "financial_plaid_idv_sessions NOT deployed yet — Plaid falls back to completed documents only and will UNDERCOUNT abandoned/Lightning sessions. Deploy + backfill for accurate Plaid figures.",
          "effectiv_calls / plaid_calls are raw vendor charge counts (cost side); billable_inquiries is the client-billed (revenue) side. Effectiv reflects the env in the DB (replica = prod; excludes UAT).",
          "FGP billable here counts Plaid-only applicants (Plaid ran, Effectiv didn't), which the legacy manual process omitted — expect higher counts than prior hand-built sheets.",
        ],
        ...result,
        summary_by_fi,
        totals: { ...result.totals, costs: totals_costs },
      };
    },

    // ── Config-change audit (default env: "prod") ────────────────────────
    //
    // Two trails, one timeline. `versions` is the coadmin back office
    // (Cotribute sysadmins only); `financial_user_audit_logs` is the
    // boa-settings portal (Cotribute staff and FI staff). Sysadmin
    // classification follows dreambigger's hasSysadminAccess rule, never the
    // email domain.

    db_audit_actors: async (args) => {
      const p = pool(args.env, "prod");

      const guard = (await p.query(SQL_AUDIT_TABLES_EXIST)).rows[0];
      if (!guard?.versions_exists && !guard?.fual_exists) {
        return { ok: false, error: "Neither audit table exists in this env." };
      }

      const sinceDays = clampInt(args.since_days, 90, 1, 730);
      const until = new Date();
      const since = new Date(until.getTime() - sinceDays * 86_400_000);

      let fiId: string | null = null;
      const rawFi = String(args.fi_query ?? "").trim();
      if (rawFi) {
        const resolved = await resolveFi(p, rawFi);
        if (!("fi" in resolved)) return resolved;
        fiId = resolved.fi.id;
      }

      // Sequential — the pool is max: 3 and these are three separate scans.
      const params = scopedParams({
        start: since.toISOString(),
        end: until.toISOString(),
        fiId,
        excluded: null,
      });
      const internal = guard?.versions_exists
        ? (await p.query(SQL_AUDIT_ACTORS_INTERNAL, params)).rows
        : [];
      const portal = guard?.fual_exists
        ? (await p.query(SQL_AUDIT_ACTORS_PORTAL, params)).rows
        : [];

      // Fold both trails onto one person, keyed on lowercased email. Cotribute
      // staff appear as one admins row plus a financial_users row per FI, so
      // without this a single person shows up dozens of times.
      const people = new Map<string, any>();
      const unresolved: any[] = [];

      const touch = (key: string, seed: () => any) => {
        let entry = people.get(key);
        if (!entry) {
          entry = seed();
          people.set(key, entry);
        }
        return entry;
      };

      for (const row of internal) {
        const email: string | null = row.admin_email
          ? String(row.admin_email).toLowerCase()
          : null;
        if (!email) {
          unresolved.push({
            whodunnit_raw: row.actor_raw === "" ? null : row.actor_raw,
            kind: row.actor_raw === "" ? "system" : "unknown_admin_id",
            rows: Number(row.rows),
            first_at: row.first_at,
            last_at: row.last_at,
            note:
              row.actor_raw === ""
                ? "Background job, console session or API write with no signed-in admin."
                : "whodunnit does not match any admins row.",
          });
          continue;
        }
        const entry = touch(email, () => blankActor(email));
        entry.admin_ids.push(String(row.admin_id));
        // An admins row carrying the Acquire portal permission IS the sysadmin
        // definition, so anyone writing to `versions` is one by construction.
        entry.kind = "sysadmin";
        mergeActivity(entry.internal, row);
        collectFis(entry, row.fi_names);
        collectTypes(entry, row.item_types);
      }

      for (const row of portal) {
        const email: string | null = row.login_id
          ? String(row.login_id).toLowerCase()
          : null;
        if (!email) {
          unresolved.push({
            whodunnit_raw: row.actor_raw,
            kind: "unknown_financial_user",
            rows: Number(row.rows),
            note: "financial_user_id does not match any financial_users row.",
          });
          continue;
        }
        const entry = touch(email, () => blankActor(email));
        if (row.first_name || row.last_name) {
          entry.display_name = [row.first_name, row.last_name]
            .filter(Boolean)
            .join(" ");
          entry.name_source = "portal_profile";
        }
        if (row.is_sysadmin) {
          entry.kind = "sysadmin";
          if (row.admin_id && !entry.admin_ids.includes(String(row.admin_id))) {
            entry.admin_ids.push(String(row.admin_id));
          }
        } else if (entry.kind !== "sysadmin") {
          entry.kind = "client";
        }
        entry.portal.financial_user_ids.push({
          fi_id: row.actor_fi_id,
          fi_name: row.actor_fi_name,
        });
        for (const r of row.roles ?? []) {
          if (!entry.roles.includes(r)) entry.roles.push(r);
        }
        mergeActivity(entry.portal, row);
        collectFis(entry, row.fi_names);
        collectTypes(entry, row.item_types);
      }

      let actors = [...people.values()];

      const query = String(args.query ?? "")
        .trim()
        .toLowerCase();
      if (query) {
        actors = actors.filter(
          (a) =>
            a.email?.includes(query) ||
            a.display_name.toLowerCase().includes(query) ||
            a.admin_ids.includes(query) ||
            a.portal.financial_user_ids.some((f: any) => f.fi_id === query)
        );
      }

      actors.sort(
        (a, b) =>
          b.internal.rows + b.portal.rows - (a.internal.rows + a.portal.rows)
      );
      for (const a of actors) finalizeActor(a);

      return {
        ok: true,
        window: { since: since.toISOString(), until: until.toISOString() },
        fi_filter: fiId,
        sysadmin_rule: `admins row holding the "${SYSADMIN_PERMISSION_GROUP}" permission group (matches dreambigger's hasSysadminAccess)`,
        actors,
        unresolved,
        notes: auditNotes(),
      };
    },

    db_config_audit_search: async (args) => {
      const p = pool(args.env, "prod");

      const guard = (await p.query(SQL_AUDIT_TABLES_EXIST)).rows[0];
      if (!guard?.versions_exists && !guard?.fual_exists) {
        return { ok: false, error: "Neither audit table exists in this env." };
      }

      const start = normalizeDate(args.start_date);
      const end = normalizeDate(args.end_date);
      if (!start || !end) {
        return {
          ok: false,
          error: "start_date and end_date must be YYYY-MM-DD.",
        };
      }
      if (start >= end) {
        return { ok: false, error: "start_date must be before end_date." };
      }

      const trail: string = ["both", "internal", "portal"].includes(args.trail)
        ? args.trail
        : "both";
      const limit = clampInt(args.limit, 50, 1, 200);
      const gapMinutes = clampInt(args.session_gap_minutes, 30, 1, 1440);

      let fiId: string | null = null;
      const rawFi = String(args.fi_query ?? "").trim();
      if (rawFi) {
        const resolved = await resolveFi(p, rawFi);
        if (!("fi" in resolved)) return resolved;
        fiId = resolved.fi.id;
      }

      // Actor resolution. An unmatched actor_query is an empty result, not an
      // unfiltered one — passing [] makes `= ANY([])` false for every row.
      let internalActorIds: string[] | null = null;
      let portalActorIds: string[] | null = null;
      const rawActor = String(args.actor_query ?? "").trim();
      if (rawActor) {
        const res = await p.query(SQL_RESOLVE_ACTOR, [
          `%${rawActor}%`,
          rawActor,
        ]);
        const row = res.rows[0] ?? {};
        internalActorIds = row.admin_ids ?? [];
        portalActorIds = row.financial_user_ids ?? [];
        if (internalActorIds!.length === 0 && portalActorIds!.length === 0) {
          return {
            ok: false,
            error: `No actor matched "${rawActor}". Call db_audit_actors to see who is in the data.`,
          };
        }
      }

      const itemTypes: string[] | null =
        Array.isArray(args.item_types) && args.item_types.length > 0
          ? args.item_types
          : null;
      // Application-level noise is excluded unless the caller asked for it.
      const excluded = itemTypes ? null : DEFAULT_EXCLUDED_ITEM_TYPES;

      const events: string[] | null =
        Array.isArray(args.events) && args.events.length > 0
          ? args.events
          : null;

      const MAX_ROWS = 5000;
      const params = scopedParams({
        start,
        end,
        itemTypes,
        events,
        internalActorIds,
        portalActorIds,
        fiId,
        trail,
        excluded,
      });

      const searchRes = await p.query(SQL_CONFIG_AUDIT_SEARCH, [
        ...params,
        MAX_ROWS,
      ]);
      const rows: AuditRow[] = searchRes.rows;

      // Resolve every actor present, then roll rows up into edit sessions.
      const actors = await buildActorIndex(p, rows);
      const provisional = rollupSessions(rows, { gapMinutes, actors });

      // Changed keys only for the sessions we're about to return — this is the
      // only query that touches object_changes, and it does so for at most a
      // few hundred ids rather than the whole table.
      const page = provisional.slice(0, limit);
      const internalIds: number[] = [];
      const portalIds: number[] = [];
      for (const s of page) {
        const target = s.trail === "internal" ? internalIds : portalIds;
        target.push(Number(s.detail_ids.first));
        if (s.detail_ids.last !== s.detail_ids.first) {
          target.push(Number(s.detail_ids.last));
        }
      }
      const keysRes = await p.query(SQL_CONFIG_AUDIT_CHANGED_KEYS, [
        internalIds,
        portalIds,
      ]);
      const changedKeys = new Map<
        string,
        { keys: string[]; bytes: number | null }
      >();
      for (const r of keysRes.rows) {
        changedKeys.set(changeKey(r.trail, r.id), {
          keys: r.changed_keys ?? [],
          bytes: r.bytes == null ? null : Number(r.bytes),
        });
      }

      const sessions = rollupSessions(rows, {
        gapMinutes,
        actors,
        changedKeys,
      }).slice(0, limit);
      flagCrossTrailDupes(sessions);

      const all = rollupSessions(rows, { gapMinutes, actors });
      const summary = summarize(all);

      const unattributed = rows.filter((r) => !r.fi_id);
      const unattributedByType = new Map<string, number>();
      for (const r of unattributed) {
        unattributedByType.set(
          r.item_type,
          (unattributedByType.get(r.item_type) ?? 0) + 1
        );
      }

      const notes = auditNotes();
      if (rows.length >= MAX_ROWS) {
        notes.push(
          `Hit the ${MAX_ROWS}-row scan cap; rollups cover only the most recent ${MAX_ROWS} rows in the window. Narrow the window or add filters.`
        );
      }
      if (unattributed.length > 0) {
        notes.push(
          "Rows with no financial institution are either types that have no FI link by design " +
            `(${NO_FI_ITEM_TYPES.join(", ")}) or destroy events whose target row is gone.`
        );
      }

      let diagnostics: any;
      if (args.include_diagnostics === true) {
        const cov = await p.query(SQL_CONFIG_AUDIT_COVERAGE, params);
        const nulls = await p.query(SQL_FUAL_NULL_ITEM_UUID, [start, end]);
        diagnostics = {
          attribution_by_item_type: cov.rows.map((r: any) => ({
            item_type: r.item_type,
            rows_total: Number(r.rows_total),
            rows_with_fi: Number(r.rows_with_fi),
            rows_null_fi: Number(r.rows_null_fi),
            expected_null: NO_FI_ITEM_TYPES.includes(r.item_type),
          })),
          fual_rows_with_null_item_uuid: Number(
            nulls.rows[0]?.null_item_uuid_rows ?? 0
          ),
        };
      }

      return {
        ok: true,
        window: { start, end },
        filters_applied: {
          actor_query: rawActor || null,
          fi_query: rawFi || null,
          item_types: itemTypes,
          excluded_item_types: excluded,
          events,
          trail,
          session_gap_minutes: gapMinutes,
        },
        coverage: await coverageFloors(p),
        totals: {
          rows: rows.length,
          sessions: all.length,
          actors: summary.by_actor.length,
          fis: summary.by_fi.filter((f) => f.fi_id).length,
          by_event: countEvents(rows),
        },
        by_actor: summary.by_actor,
        by_actor_kind: summary.by_actor_kind,
        by_fi: summary.by_fi,
        by_item_type: summary.by_item_type,
        by_month: summary.by_month,
        unattributed_fi: {
          rows: unattributed.length,
          by_item_type: [...unattributedByType.entries()]
            .map(([item_type, n]) => ({ item_type, rows: n }))
            .sort((a, b) => b.rows - a.rows),
        },
        sessions,
        truncated: all.length > sessions.length,
        ...(diagnostics ? { diagnostics } : {}),
        notes,
      };
    },

    db_config_audit_detail: async (args) => {
      const p = pool(args.env, "prod");

      if (args.trail !== "internal" && args.trail !== "portal") {
        return { ok: false, error: 'trail must be "internal" or "portal".' };
      }
      const id = Number(args.id);
      if (!Number.isInteger(id) || id <= 0) {
        return { ok: false, error: "id must be a positive integer." };
      }

      const sql =
        args.trail === "internal"
          ? SQL_CONFIG_AUDIT_DETAIL_INTERNAL
          : SQL_CONFIG_AUDIT_DETAIL_PORTAL;
      const res = await p.query(sql, [id]);
      const row = res.rows[0];
      if (!row) {
        return {
          ok: false,
          error: `No ${args.trail} audit row with id ${id}.`,
        };
      }

      const mode = args.mode === "values" ? "values" : "structural";
      const keys = Array.isArray(args.keys) ? args.keys : undefined;
      const rendered = renderChanges(row.item_type, row.object_changes, {
        mode,
        keys,
      });

      const actors = await buildActorIndex(p, [row as AuditRow]);
      const actor = actors.get(actorKeyOf(row as AuditRow));

      return {
        ok: true,
        trail: row.trail,
        id: Number(row.id),
        item_type: row.item_type,
        item_id: row.item_id,
        event: row.event,
        occurred_at: row.occurred_at,
        ip: row.ip,
        actor: actor
          ? {
              display_name: actor.display_name,
              email: actor.email,
              kind: actor.kind,
            }
          : null,
        total_bytes: row.bytes == null ? null : Number(row.bytes),
        ...rendered,
        notes: [...rendered.notes, ...auditNotes()],
      };
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Config-audit helpers ────────────────────────────────────────────────────

/** Positional params for the shared `scoped` CTE ($1–$9). */
function scopedParams(opts: {
  start: string;
  end: string;
  itemTypes?: string[] | null;
  events?: string[] | null;
  internalActorIds?: string[] | null;
  portalActorIds?: string[] | null;
  fiId?: string | null;
  trail?: string;
  excluded?: string[] | null;
}): any[] {
  return [
    opts.start,
    opts.end,
    opts.itemTypes ?? null,
    opts.events ?? null,
    opts.internalActorIds ?? null,
    opts.portalActorIds ?? null,
    opts.fiId ?? null,
    opts.trail ?? "both",
    opts.excluded ?? null,
  ];
}

// Backstops for db_list_customer_users. The role predicate holds the real list
// to ~1.4k rows, but financial_users has 433k rows total, so a schema change or
// a bad edit to the predicate must not be able to dump the table into the model
// context. MAX_CUSTOMER_USER_BYTES is measured against the pretty-printed JSON
// server.ts actually sends (see the same reasoning in src/aia/client.ts).
const MAX_CUSTOMER_USER_ROWS = 20000;
const MAX_CUSTOMER_USER_BYTES = 400_000;

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function normalizeDate(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function countEvents(rows: AuditRow[]): Record<string, number> {
  const out: Record<string, number> = { create: 0, update: 0, destroy: 0 };
  for (const r of rows) out[r.event] = (out[r.event] ?? 0) + 1;
  return out;
}

function blankActor(email: string): any {
  return {
    display_name: nameFromEmail(email),
    name_source: "email_heuristic",
    email,
    kind: "client" as ActorKind,
    admin_ids: [] as string[],
    roles: [] as string[],
    fis: [] as string[],
    top_item_types: [] as string[],
    internal: { rows: 0, first_at: null, last_at: null },
    portal: {
      rows: 0,
      first_at: null,
      last_at: null,
      financial_user_ids: [] as any[],
    },
  };
}

function mergeActivity(target: any, row: any) {
  target.rows += Number(row.rows);
  const first = row.first_at ? new Date(row.first_at).toISOString() : null;
  const last = row.last_at ? new Date(row.last_at).toISOString() : null;
  if (first && (!target.first_at || first < target.first_at))
    target.first_at = first;
  if (last && (!target.last_at || last > target.last_at)) target.last_at = last;
}

function collectFis(entry: any, names: string[] | null) {
  for (const n of names ?? []) if (!entry.fis.includes(n)) entry.fis.push(n);
}

function collectTypes(entry: any, types: string[] | null) {
  for (const t of types ?? [])
    if (!entry.top_item_types.includes(t)) entry.top_item_types.push(t);
}

function finalizeActor(entry: any) {
  entry.fis.sort();
  entry.top_item_types.sort();
  entry.fi_count = entry.fis.length;
  entry.total_rows = entry.internal.rows + entry.portal.rows;
}

/**
 * Resolve every actor referenced by a set of rows to a name, email and kind.
 *
 * Internal rows carry an `admins.id`; portal rows carry a `financial_users.id`.
 * Sysadmin status comes from the "[Acquire] Applications Portal" permission
 * group, matching dreambigger's hasSysadminAccess — never from the email
 * domain.
 */
async function buildActorIndex(
  p: Pool,
  rows: AuditRow[]
): Promise<Map<string, ActorRef>> {
  const out = new Map<string, ActorRef>();
  const adminIds = new Set<string>();
  const userIds = new Set<string>();

  for (const r of rows) {
    if (r.trail === "internal") {
      if (r.actor_raw) adminIds.add(r.actor_raw);
    } else if (r.actor_raw) {
      userIds.add(r.actor_raw);
    }
  }

  const sysadmins = new Map<string, string>();
  for (const r of (await p.query(SQL_SYSADMIN_EMAILS)).rows) {
    sysadmins.set(String(r.email), String(r.admin_id));
  }

  if (adminIds.size > 0) {
    // `admins` has no name columns, so pick up the person's real name from
    // their portal profile in the same query rather than a second round trip.
    const res = await p.query(
      `SELECT a.id::text AS id, lower(a.email) AS email,
              (SELECT fu.first_name || ' ' || fu.last_name
                 FROM financial_users fu
                WHERE lower(fu.login_id) = lower(a.email)
                  AND fu.first_name IS NOT NULL
                LIMIT 1) AS profile_name
         FROM admins a
        WHERE a.id::text = ANY($1::text[])`,
      [[...adminIds]]
    );
    for (const r of res.rows) {
      out.set(actorKey("internal", r.id), {
        actor_key: r.email,
        display_name: r.profile_name?.trim() || nameFromEmail(r.email),
        email: r.email,
        // Writing to `versions` requires a coadmin login, so these are staff by
        // construction; the permission group confirms it where present.
        kind: "sysadmin",
        admin_id: sysadmins.get(r.email) ?? r.id,
      });
    }
  }

  if (userIds.size > 0) {
    const res = await p.query(
      `SELECT id::text AS id, lower(login_id) AS email, login_id_type,
              first_name, last_name
         FROM financial_users
        WHERE id = ANY($1::uuid[])`,
      [[...userIds]]
    );
    for (const r of res.rows) {
      const isSysadmin =
        r.login_id_type === "email" && sysadmins.has(String(r.email));
      const name = [r.first_name, r.last_name].filter(Boolean).join(" ");
      out.set(actorKey("portal", r.id), {
        actor_key: r.email,
        display_name: name || nameFromEmail(r.email),
        email: r.email,
        kind: isSysadmin ? "sysadmin" : "client",
        admin_id: isSysadmin ? sysadmins.get(String(r.email)) : null,
      });
    }
  }

  // The internal trail only knows an admins row, and `admins` has no name
  // columns — so backfill real names from the portal profile of the same
  // person (matched on email) before falling back to the email heuristic.
  const namesByEmail = new Map<string, string>();
  for (const ref of out.values()) {
    if (ref.email && ref.display_name !== nameFromEmail(ref.email)) {
      namesByEmail.set(ref.email, ref.display_name);
    }
  }
  for (const ref of out.values()) {
    const better = ref.email ? namesByEmail.get(ref.email) : undefined;
    if (better) ref.display_name = better;
  }

  // Blank whodunnit: a background job, console session or API write.
  out.set(actorKey("internal", ""), {
    actor_key: "__system__",
    display_name: "System (background job)",
    email: null,
    kind: "system",
  });

  return out;
}

async function coverageFloors(p: Pool) {
  const r = (await p.query(SQL_AUDIT_COVERAGE)).rows[0] ?? {};
  return { versions_since: r.versions_since, fual_since: r.fual_since };
}

function auditNotes(): string[] {
  return [
    "Counts are edit sessions, not rows: PaperTrail writes one row per save, so a single editing session commonly produces 7+ rows.",
    "`legacy_model_versions` is NOT part of this data. It holds 4.8M rows of legacy WeServe runtime records (Pulse, EmailMetric, Token) and no Acquire configuration.",
    'Sysadmin vs client comes from the "[Acquire] Applications Portal" permission group on the `admins` row (dreambigger\'s hasSysadminAccess), not from the email domain.',
    "A few pre-sysadmin-era shared accounts — notably support@cotributemail.com, one of the busiest portal actors — have no `admins` row and therefore classify as `client`. That construct predates the permission model and the individuals behind it are not recoverable.",
    "Audit coverage in settings-api is incomplete: brand settings, custom domains, MFA settings and the PDF template builder have mutating routes with no audit wiring, and write failures are logged rather than raised. Absence of rows means 'not recorded', not 'did not happen'.",
  ];
}
