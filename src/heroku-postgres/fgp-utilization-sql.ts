// SQL for the /generate-fgp-utilization Cowork skill.
//
// Fetches LEAN per-applicant candidate rows for Effectiv (Fraud Guard+) and
// Plaid IDV over a date window. The handler dedupes/classifies these in TS
// (see fgp-utilization.ts) and returns compact per-FI aggregates — we never
// ship the raw rows through the model context.
//
// Shared params for the vendor queries:
//   $1 = start_date (inclusive, 'YYYY-MM-DD')
//   $2 = end_date   (exclusive, 'YYYY-MM-DD')
//   $3 = fi_id filter (uuid) or NULL for all FIs
//
// Demo/test FIs: organizations.meta->>'financialInstitutionId' links a WeServe
// organization to a financial_institution; organizations.meta is a `json`
// column (not jsonb). acquireFraudGuardDemoMode flags an FI as demo so its
// inquiries are bucketed non-billable rather than billed to the client.
//
// Effectiv "reached the fraud step" mirrors the canonical reporting filter
// (raw_response_body->'third_party_executions'->0->'response'->'fraud' IS NOT
// NULL). We return it as a boolean rather than filtering so non-billable failed
// calls remain visible to finance.

export const SQL_FGP_DEMO_FI_IDS = `
SELECT (o.meta->>'financialInstitutionId')::uuid AS fi_id
FROM organizations o
WHERE o.meta->>'financialInstitutionId' IS NOT NULL
  AND lower(coalesce(o.meta->>'acquireFraudGuardDemoMode','')) = 'true'
`;

export const SQL_FGP_EFFECTIV_CANDIDATES = `
SELECT
  ee.uuid,
  ee.onboarding_application_id::text AS app_id,
  fi.id::text   AS fi_id,
  fi.name       AS fi_name,
  fi.slug       AS fi_slug,
  ee.slug       AS slug,
  ee.person->>'firstName' AS first_name,
  ee.person->>'lastName'  AS last_name,
  ee.person->>'birthday'  AS dob,
  right(regexp_replace(coalesce(ee.person->>'ssn',''), '[^0-9]', '', 'g'), 4) AS ssn_last4,
  (ee.raw_response_body->'third_party_executions'->0->'response'->'fraud' IS NOT NULL) AS reached_fraud_step,
  ee.decision,
  ee.created_at
FROM effectiv_evaluations ee
JOIN onboarding_applications oa ON oa.id = ee.onboarding_application_id
JOIN financial_users fu ON fu.id = oa.financial_user_id
JOIN financial_institutions fi ON fi.id = fu.financial_institution_id
WHERE ee.created_at >= $1::date
  AND ee.created_at < $2::date
  AND ($3::uuid IS NULL OR fi.id = $3::uuid)
`;

// Plaid IDV: client_user_id is "{onboarding_application_id}|{slug}". The
// document carries extracted government-ID data: name {given_name, family_name}
// and date_of_birth (present on ~96% of rows in validation).
export const SQL_FGP_PLAID_DOCUMENT_CANDIDATES = `
SELECT
  pid.uuid,
  split_part(pid.client_user_id, '|', 1) AS app_id,
  fi.id::text AS fi_id,
  fi.name     AS fi_name,
  fi.slug     AS fi_slug,
  nullif(split_part(pid.client_user_id, '|', 2), '') AS slug,
  pid.extracted_data->'name'->>'given_name'  AS first_name,
  pid.extracted_data->'name'->>'family_name' AS last_name,
  pid.extracted_data->>'date_of_birth'       AS dob,
  pid.status,
  pid.document_status,
  pid.identity_verification_id,
  'document'::text AS source,
  pid.created_at
FROM financial_plaid_idv_documents pid
JOIN onboarding_applications oa ON oa.id = pid.onboarding_application_id
JOIN financial_users fu ON fu.id = oa.financial_user_id
JOIN financial_institutions fi ON fi.id = fu.financial_institution_id
WHERE pid.created_at >= $1::date
  AND pid.created_at < $2::date
  AND ($3::uuid IS NULL OR fi.id = $3::uuid)
`;

// Plaid IDV sessions (abandoned + email/shareable sessions that Plaid bills but
// that never produced a completed document). This table is added by a
// dreambigger migration; the handler checks for its existence before querying so
// the tool works both before and after that migration deploys. We only pull the
// sessions that did NOT produce a document (anti-join below); those WITH a
// document are already counted via SQL_FGP_PLAID_DOCUMENT_CANDIDATES, which also
// carries PII. Session-only rows have no parsed PII, so attribution falls back
// to (app_id, slug).
export const SQL_FGP_PLAID_SESSION_CANDIDATES = `
SELECT
  s.uuid,
  s.onboarding_application_id::text AS app_id,
  fi.id::text AS fi_id,
  fi.name     AS fi_name,
  fi.slug     AS fi_slug,
  s.slug,
  NULL::text  AS first_name,
  NULL::text  AS last_name,
  NULL::text  AS dob,
  s.status,
  NULL::text  AS document_status,
  s.identity_verification_id,
  'session'::text AS source,
  s.created_at
FROM financial_plaid_idv_sessions s
JOIN onboarding_applications oa ON oa.id = s.onboarding_application_id
JOIN financial_users fu ON fu.id = oa.financial_user_id
JOIN financial_institutions fi ON fi.id = fu.financial_institution_id
LEFT JOIN financial_plaid_idv_documents pid
  ON pid.identity_verification_id = s.identity_verification_id
WHERE s.created_at >= $1::date
  AND s.created_at < $2::date
  AND ($3::uuid IS NULL OR fi.id = $3::uuid)
  AND pid.uuid IS NULL
`;

export const SQL_FGP_SESSIONS_EXISTS = `
SELECT to_regclass('public.financial_plaid_idv_sessions') IS NOT NULL AS exists
`;

// FI resolution for the optional fi_query filter (name fragment / slug / uuid).
export const SQL_FGP_RESOLVE_FI_BY_UUID = `
SELECT id, name, slug FROM financial_institutions WHERE id = $1
`;

export const SQL_FGP_RESOLVE_FI_BY_TEXT = `
SELECT id, name, slug
FROM financial_institutions
WHERE name ILIKE $1 OR slug ILIKE $1
ORDER BY name
LIMIT 10
`;
