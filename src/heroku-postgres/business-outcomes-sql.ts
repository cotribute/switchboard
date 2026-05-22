// SQL battery for the /generate-business-outcomes Cowork skill.
//
// Mirrors the queries in dreambigger's .claude/agents/generate-business-outcomes.md
// (Step 2). Each query is parameterized — $1 is always the financial_institutions.id,
// and $2 (where present) is the reporting end date in 'YYYY-MM-DD' form.
//
// Quirks to preserve (validated against reference docs):
// - FIS GKYC joins via fis_gkyc_configurations.financial_institution_id, not via
//   onboarding_applications (the FK on fis_gkyc_evaluations is unreliable).
// - Only the risk-signal cohort filters base apps by created_at <= end_date.
//   The other queries deliberately do not date-bound. This matches how the seven
//   reference business-outcomes docs were generated.

export const SQL_PRODUCT_OVERVIEW = `
WITH fi_products AS (
  SELECT fi.id AS fi_id, fi.name AS fi_name, fip.id AS fip_id, fip.slug AS product_slug
  FROM financial_institutions fi
  JOIN financial_institution_products fip ON fip.financial_institution_id = fi.id
  WHERE fi.id = $1
)
SELECT fp.product_slug,
  COUNT(DISTINCT f.id) FILTER (WHERE f.status='active') AS active_flows,
  COUNT(oa.id) AS total_apps,
  COUNT(oa.id) FILTER (WHERE oa.status='complete') AS complete,
  COUNT(oa.id) FILTER (WHERE oa.status='submitted') AS submitted,
  COUNT(oa.id) FILTER (WHERE oa.status='pending_submit') AS pending_submit,
  COUNT(oa.id) FILTER (WHERE oa.status='draft') AS draft,
  COUNT(oa.id) FILTER (WHERE oa.status='canceled') AS canceled,
  COUNT(oa.id) FILTER (WHERE oa.status='failed') AS failed,
  MIN(oa.created_at)::date AS first_app,
  MAX(oa.created_at)::date AS last_app
FROM fi_products fp
LEFT JOIN flows f ON f.financial_institution_product_id = fp.fip_id
LEFT JOIN onboarding_applications oa ON oa.flow_id = f.id
GROUP BY fp.product_slug
ORDER BY total_apps DESC NULLS LAST
`;

export const SQL_DECISION_DISTRIBUTION = `
SELECT fip.slug AS product, ds.title, ds.decision, COUNT(oa.id) AS apps
FROM financial_institutions fi
JOIN financial_institution_products fip ON fip.financial_institution_id = fi.id
JOIN flows f ON f.financial_institution_product_id = fip.id
JOIN onboarding_applications oa ON oa.flow_id = f.id
JOIN decision_statuses ds ON ds.uuid = oa.decision_status_uuid
WHERE fi.id = $1
  AND oa.status NOT IN ('draft','archived')
GROUP BY fip.slug, ds.title, ds.decision
ORDER BY fip.slug, apps DESC
`;

export const SQL_FLOW_BREAKDOWN = `
SELECT fip.slug AS product, f.title,
  COUNT(oa.id) AS apps,
  COUNT(oa.id) FILTER (WHERE oa.status NOT IN ('draft','archived')) AS decisioned,
  COUNT(oa.id) FILTER (WHERE ds.title='Approved') AS approved,
  COUNT(oa.id) FILTER (WHERE ds.decision='denied') AS denied,
  COUNT(oa.id) FILTER (WHERE oa.status='draft') AS drafts,
  COUNT(oa.id) FILTER (WHERE oa.status='pending_submit') AS pending
FROM financial_institutions fi
JOIN financial_institution_products fip ON fip.financial_institution_id = fi.id
JOIN flows f ON f.financial_institution_product_id = fip.id
LEFT JOIN onboarding_applications oa ON oa.flow_id = f.id
LEFT JOIN decision_statuses ds ON ds.uuid = oa.decision_status_uuid
WHERE fi.id = $1
GROUP BY fip.slug, f.title
ORDER BY apps DESC NULLS LAST
`;

// Risk-signal sources that join via onboarding_applications:
// Fraud Guard+ (effectiv_evaluations), Cotribute IDV (financial_plaid_idv_documents),
// Corelation ChexSystems (corelation_chex_systems_evaluations).
export const SQL_RISK_SIGNALS_VIA_APPS = `
WITH fi_apps AS (
  SELECT oa.id
  FROM financial_institution_products fip
  JOIN flows f ON f.financial_institution_product_id = fip.id
  JOIN onboarding_applications oa ON oa.flow_id = f.id
  WHERE fip.financial_institution_id = $1
    AND oa.status NOT IN ('draft','archived')
    AND oa.created_at <= ($2::date + INTERVAL '1 day' - INTERVAL '1 second')
)
SELECT
  COUNT(DISTINCT ee.uuid) AS fg_checks,
  COUNT(DISTINCT ee.uuid) FILTER (WHERE ee.decision='DECLINE') AS fg_decline,
  COUNT(DISTINCT ee.uuid) FILTER (WHERE ee.decision='REVIEW') AS fg_review,
  COUNT(DISTINCT ee.uuid) FILTER (WHERE ee.decision='APPROVE') AS fg_approve,
  COUNT(DISTINCT pid.uuid) AS idv_attempts,
  COUNT(DISTINCT pid.uuid) FILTER (WHERE pid.status='success' AND pid.document_status='success') AS idv_clean,
  COUNT(DISTINCT chx.uuid) AS chex_checks
FROM fi_apps fa
LEFT JOIN effectiv_evaluations ee ON ee.onboarding_application_id = fa.id
LEFT JOIN financial_plaid_idv_documents pid ON pid.onboarding_application_id = fa.id
LEFT JOIN corelation_chex_systems_evaluations chx ON chx.onboarding_application_id = fa.id
`;

// FIS GKYC has a usable FK on its configuration table — go through it.
export const SQL_FIS_GKYC = `
SELECT
  COUNT(DISTINCT fg.uuid) AS gkyc_checks,
  COUNT(DISTINCT fg.uuid) FILTER (WHERE fg.final_result='Fail') AS gkyc_fail,
  COUNT(DISTINCT fg.uuid) FILTER (WHERE fg.final_result='Pass') AS gkyc_pass,
  COUNT(DISTINCT fg.uuid) FILTER (WHERE fg.final_result='Review') AS gkyc_review
FROM fis_gkyc_evaluations fg
JOIN fis_gkyc_configurations fgc ON fgc.uuid = fg.fis_gkyc_configuration_uuid
WHERE fgc.financial_institution_id = $1
  AND fg.created_at <= ($2::date + INTERVAL '1 day' - INTERVAL '1 second')
`;

export const SQL_OFAC = `
SELECT
  COUNT(DISTINCT wo.uuid) AS orders,
  COUNT(DISTINCT wo.financial_application_uuid) AS apps_checked,
  COUNT(DISTINCT wh.uuid) AS hits
FROM financial_institutions fi
JOIN financial_applications fa ON fa.financial_institution_id = fi.id AND fa.deleted_at IS NULL
LEFT JOIN financial_application_watchlist_orders wo ON wo.financial_application_uuid = fa.uuid AND wo.deleted_at IS NULL
LEFT JOIN financial_application_watchlist_reports wr ON wr.financial_application_watchlist_order_uuid = wo.uuid AND wr.deleted_at IS NULL
LEFT JOIN financial_application_watchlist_hits wh ON wh.financial_application_watchlist_report_uuid = wr.uuid
WHERE fi.id = $1
`;

export const SQL_DECISION_AUTOMATION = `
WITH fi_apps AS (
  SELECT fip.slug AS product, oa.id
  FROM financial_institutions fi
  JOIN financial_institution_products fip ON fip.financial_institution_id = fi.id
  JOIN flows f ON f.financial_institution_product_id = fip.id
  JOIN onboarding_applications oa ON oa.flow_id = f.id
  WHERE fi.id = $1 AND oa.status NOT IN ('draft','archived')
)
SELECT fa.product,
  COUNT(DISTINCT fa.id) AS apps,
  COUNT(dsl.uuid) AS total_transitions,
  COUNT(dsl.uuid) FILTER (WHERE dsl.decision_rule_uuid IS NOT NULL) AS rule_transitions,
  COUNT(dsl.uuid) FILTER (WHERE dsl.decision_rule_uuid IS NULL AND dsl.user_id IS NOT NULL) AS admin_transitions
FROM fi_apps fa
LEFT JOIN decision_status_logs dsl ON dsl.onboarding_application_id = fa.id
GROUP BY fa.product ORDER BY apps DESC
`;

export const SQL_TIME_TO_DECISION = `
WITH fi_apps AS (
  SELECT fip.slug AS product, oa.id AS oa_id, oa.created_at
  FROM financial_institutions fi
  JOIN financial_institution_products fip ON fip.financial_institution_id = fi.id
  JOIN flows f ON f.financial_institution_product_id = fip.id
  JOIN onboarding_applications oa ON oa.flow_id = f.id
  WHERE fi.id = $1 AND oa.status NOT IN ('draft','archived')
),
ft AS (
  SELECT fa.product, fa.oa_id, fa.created_at,
    MIN(dsl.created_at) FILTER (WHERE ds.decision='approved') AS first_approval,
    MIN(dsl.created_at) FILTER (WHERE ds.decision='denied') AS first_denial
  FROM fi_apps fa
  LEFT JOIN decision_status_logs dsl ON dsl.onboarding_application_id = fa.oa_id
  LEFT JOIN decision_statuses ds ON ds.uuid = dsl.new_decision_status_uuid
  GROUP BY fa.product, fa.oa_id, fa.created_at
)
SELECT product,
  COUNT(*) FILTER (WHERE first_approval IS NOT NULL) AS approved,
  COUNT(*) FILTER (WHERE first_denial IS NOT NULL) AS denied,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_approval - created_at))/60.0) FILTER (WHERE first_approval IS NOT NULL) AS median_min_to_approve,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_denial - created_at))/60.0) FILTER (WHERE first_denial IS NOT NULL) AS median_min_to_deny
FROM ft GROUP BY product
HAVING COUNT(*) FILTER (WHERE first_approval IS NOT NULL OR first_denial IS NOT NULL) > 0
ORDER BY product
`;

export const SQL_UNIQUE_USERS = `
SELECT
  COUNT(DISTINCT oa.financial_user_id) AS unique_users,
  COUNT(DISTINCT oa.id) AS total_apps,
  MIN(oa.created_at)::date AS first_app,
  MAX(oa.created_at)::date AS last_app
FROM financial_institutions fi
JOIN financial_institution_products fip ON fip.financial_institution_id = fi.id
JOIN flows f ON f.financial_institution_product_id = fip.id
JOIN onboarding_applications oa ON oa.flow_id = f.id
WHERE fi.id = $1
`;

export const SQL_MONTHLY_TREND = `
WITH apps AS (
  SELECT oa.id, oa.created_at, ds.decision, ds.title
  FROM financial_institutions fi
  JOIN financial_institution_products fip ON fip.financial_institution_id = fi.id
  JOIN flows f ON f.financial_institution_product_id = fip.id
  JOIN onboarding_applications oa ON oa.flow_id = f.id
  LEFT JOIN decision_statuses ds ON ds.uuid = oa.decision_status_uuid
  WHERE fi.id = $1 AND oa.status NOT IN ('draft','archived')
)
SELECT date_trunc('month', created_at)::date AS month,
  COUNT(*) AS submitted,
  COUNT(*) FILTER (WHERE decision='approved' OR title='Approved') AS approved,
  COUNT(*) FILTER (WHERE decision='denied') AS denied,
  COUNT(*) FILTER (WHERE decision='review') AS review
FROM apps GROUP BY month ORDER BY month
`;

export const SQL_LOAN_DOLLARS = `
SELECT fip.slug,
  COUNT(*) AS apps,
  COUNT(*) FILTER (WHERE fa.loan_amount IS NOT NULL AND fa.loan_amount <= 500000) AS apps_w_amount,
  ROUND(SUM(fa.loan_amount) FILTER (WHERE fa.loan_amount <= 500000)::numeric, 0) AS total_demand,
  ROUND(AVG(fa.loan_amount) FILTER (WHERE fa.loan_amount <= 500000)::numeric, 0) AS avg_loan,
  ROUND(SUM(fa.loan_amount) FILTER (WHERE fa.loan_amount <= 500000 AND ds.decision='approved')::numeric, 0) AS approved_dollars,
  ROUND(SUM(fa.loan_amount) FILTER (WHERE fa.loan_amount <= 500000 AND ds.decision='denied')::numeric, 0) AS denied_dollars
FROM financial_applications fa
JOIN onboarding_applications oa ON oa.id = fa.onboarding_application_id
JOIN flows f ON f.id = oa.flow_id
JOIN financial_institution_products fip ON fip.id = f.financial_institution_product_id
LEFT JOIN decision_statuses ds ON ds.uuid = oa.decision_status_uuid
WHERE fa.financial_institution_id = $1
  AND oa.status NOT IN ('draft','archived')
  AND fa.deleted_at IS NULL
GROUP BY fip.slug
`;
