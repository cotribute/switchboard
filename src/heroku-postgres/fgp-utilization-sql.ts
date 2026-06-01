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

// Plaid IDV sessions — the system-of-truth source (financial_plaid_idv_sessions),
// one row per session, used when the table exists (after the dreambigger
// migration + backfill). This SUPERSEDES the documents source: the sessions
// table captures every session (completed, abandoned, email/shareable), carries
// the full Plaid object in `raw` (incl. PII for cross-vendor dedup), and the row
// IS the billable unit Plaid bills Base on.
//
// Billable filter = "something ran": a verification step executed (data-source/KYC
// OR document OR selfie). This is what triggers Plaid's IV-Base charge — validated
// to within 0.04% of the Plaid invoice. Sessions abandoned before any check (just
// created) are excluded (Plaid charges nothing).
//
// Window = UTC calendar month (confirmed as Plaid's billing boundary: dashboard /
// invoice bucket by UTC day). $1/$2 are 'YYYY-MM-DD'. Cast to TIMESTAMP (not
// date) before AT TIME ZONE 'UTC': "$1::timestamp AT TIME ZONE 'UTC'" pins the
// boundary to UTC midnight regardless of the DB session timezone. ($1::date AT
// TIME ZONE would first cast the date to timestamptz in the SESSION tz, shifting
// the boundary — verified bug.)
//
// PII for dedup comes from raw->'user' (what we sent Plaid: name + date_of_birth).
export const SQL_FGP_PLAID_SESSION_CANDIDATES = `
SELECT
  s.uuid,
  s.onboarding_application_id::text AS app_id,
  fi.id::text AS fi_id,
  fi.name     AS fi_name,
  fi.slug     AS fi_slug,
  s.slug,
  s.raw->'user'->'name'->>'given_name'  AS first_name,
  s.raw->'user'->'name'->>'family_name' AS last_name,
  s.raw->'user'->>'date_of_birth'       AS dob,
  s.status,
  s.raw->'steps'->>'documentary_verification' AS document_status,
  s.raw->'template'->>'id'                   AS plaid_template_id,
  -- Plaid line-item charge flags. IV-Base is implicit (= the row exists), so it
  -- equals the result row count post-filter. IV-Doc/IV-Selfie fire when the
  -- respective step ran (any status other than not_applicable / waiting_for_*).
  ((s.raw->'steps'->>'documentary_verification' IS NOT NULL
    AND s.raw->'steps'->>'documentary_verification' NOT IN ('not_applicable','waiting_for_prerequisite'))) AS doc_ran,
  ((s.raw->'steps'->>'selfie_check' IS NOT NULL
    AND s.raw->'steps'->>'selfie_check' NOT IN ('not_applicable','waiting_for_prerequisite'))) AS selfie_ran,
  s.identity_verification_id,
  'session'::text AS source,
  s.created_at
FROM financial_plaid_idv_sessions s
JOIN onboarding_applications oa ON oa.id = s.onboarding_application_id
JOIN financial_users fu ON fu.id = oa.financial_user_id
JOIN financial_institutions fi ON fi.id = fu.financial_institution_id
WHERE s.created_at >= ($1::timestamp AT TIME ZONE 'UTC')
  AND s.created_at < ($2::timestamp AT TIME ZONE 'UTC')
  AND ($3::uuid IS NULL OR fi.id = $3::uuid)
  AND (
    s.raw->'kyc_check'->>'status' IN ('success','failed')
    OR (s.raw->'steps'->>'documentary_verification' IS NOT NULL
        AND s.raw->'steps'->>'documentary_verification' NOT IN ('not_applicable','waiting_for_prerequisite'))
    OR (s.raw->'steps'->>'selfie_check' IS NOT NULL
        AND s.raw->'steps'->>'selfie_check' NOT IN ('not_applicable','waiting_for_prerequisite'))
  )
`;

// Identify Lightning templates: Plaid's API doesn't tag a session "this was
// Lightning", and the financial_plaid_idv_templates row has no flag either. The
// reliable signature is in the IDV payload's kyc_check field — Lightning
// templates run a data-source KYC check whose result is a structured object
// (name/address/DOB summaries); Document-only templates never invoke that step
// and the field is null. So a template is Lightning iff ANY of its sessions has
// raw->kyc_check as a jsonb object.
//
// Validated on the local prod restore: this rule recovered 9,327 of the 9,522
// Lightning sessions on the March Plaid invoice (98%). The earlier "low doc-ran
// ratio" heuristic missed templates that ALWAYS step up to doc — e.g. Brazos's
// Lightning template (972 sessions, 92% doc-ran) is correctly flagged here.
export const SQL_FGP_LIGHTNING_TEMPLATE_IDS = `
SELECT DISTINCT s.raw->'template'->>'id' AS plaid_template_id
FROM financial_plaid_idv_sessions s
WHERE jsonb_typeof(s.raw->'kyc_check') = 'object'
  AND s.raw->'template'->>'id' IS NOT NULL
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
