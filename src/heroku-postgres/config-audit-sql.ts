// SQL for the config-change audit tools (db_audit_actors,
// db_config_audit_search, db_config_audit_detail).
//
// Two audit trails, same database:
//
//   versions                    PaperTrail, written by the coadmin Rails app.
//                               Internal (Cotribute sysadmin) changes only.
//                               whodunnit = admins.id as text; blank = a
//                               background job. item_id is a uuid.
//
//   financial_user_audit_logs   Written by settings-api / boa-settings. Both
//                               Cotribute staff and FI staff. Actor is
//                               financial_user_id.
//
// NOT included: legacy_model_versions. Same PaperTrail schema, but it holds the
// integer-PK legacy WeServe models (Pulse, EmailMetric, Token, Bucket) — 4.8M
// rows of runtime data and zero Acquire config. The uuid/integer split is
// mechanical (coadmin's ApplicationRecord picks the concern by primary-key
// type), and every Acquire config model is uuid-PK, so `versions` is the whole
// internal config story.
//
// ── Timezone ────────────────────────────────────────────────────────────────
// versions.created_at is `timestamp` (no tz); financial_user_audit_logs.created_at
// is `timestamptz`. Merging them onto one timeline requires lifting the former
// with `AT TIME ZONE 'UTC'`, or a timestamptz bound gets reinterpreted in the
// session timezone and the window silently shifts by hours. Same class of bug
// as the Plaid UTC boundary noted in fgp-utilization-sql.ts.
//
// ── Payload ─────────────────────────────────────────────────────────────────
// object_changes averages 23KB and peaks at 242KB for Flow rows. The search
// query NEVER references object/object_changes, so scanning it detoasts
// nothing. Changed keys are extracted by a second query against only the row
// ids that survived paging (SQL_CONFIG_AUDIT_CHANGED_KEYS).
//
// ── Join keys ───────────────────────────────────────────────────────────────
// versions.item_id (uuid) and financial_user_audit_logs.item_uuid (uuid) both
// join the target table's primary key — which is `id` on the newer tables
// (flows, financial_institutions, financial_institution_products,
// financial_users, onboarding_applications) and `uuid` on the rest. The per-
// branch `pk` field below records which. FUAL also has an integer `item_id` for
// integer-PK targets; we deliberately do NOT coalesce across the two — the
// types don't match and a silent miss beats a wrong FI. The handler reports how
// many FUAL rows had a null item_uuid so a bad assumption surfaces.
//
// ── Soft deletes ────────────────────────────────────────────────────────────
// Attribution joins intentionally omit `deleted_at IS NULL`. A soft-deleted
// flow still needs its FI resolved — this is history, not current state.

export const SQL_AUDIT_TABLES_EXIST = `
SELECT to_regclass('public.versions')                   IS NOT NULL AS versions_exists,
       to_regclass('public.financial_user_audit_logs')   IS NOT NULL AS fual_exists
`;

// Earliest row in each trail. A question about a period before these floors
// returns zero rows, which must not be read as "no changes were made".
export const SQL_AUDIT_COVERAGE = `
SELECT (SELECT min(created_at AT TIME ZONE 'UTC') FROM versions)                 AS versions_since,
       (SELECT min(created_at)                    FROM financial_user_audit_logs) AS fual_since
`;

// ── FI attribution ──────────────────────────────────────────────────────────
//
// Neither trail carries a financial_institution_id. `versions` has none at all,
// and financial_user_audit_logs only knows the ACTOR's FI, which is not the
// record's FI (Cotribute staff hold a financial_users row in ~28 FIs each).
// So FI is resolved per item_type by joining the target table.
//
// The union below is driven off the already-filtered `scoped` CTE, so each
// branch is an index probe over only the rows of its own item_type. The
// rejected alternatives: 34 LEFT JOIN LATERALs (every lateral evaluated per row
// regardless of type), and a pre-built entity→FI mapping CTE (materializes all
// of onboarding_applications first).

export type AttributionBranch = {
  itemTypes: string[];
  /** Joins starting from `scoped s`. The target row must be aliased `x`. */
  from: string;
  /** SQL expression yielding the financial_institutions.id. */
  fiExpr: string;
  /** SQL expression yielding a human label for the record, or "NULL". */
  labelExpr: string;
};

export const FI_ATTRIBUTION: AttributionBranch[] = [
  // The item IS the financial institution.
  {
    itemTypes: ["FinancialInstitution"],
    from: "JOIN financial_institutions x ON x.id = s.item_id",
    fiExpr: "x.id",
    labelExpr: "x.name",
  },

  // Direct financial_institution_id on the target table.
  ...(
    [
      [
        "CoreBankingConfiguration",
        "core_banking_configurations",
        "uuid",
        "x.description",
      ],
      [
        "CoreBankingCredential",
        "core_banking_credentials",
        "uuid",
        "x.description",
      ],
      ["FinancialDisclosure", "financial_disclosures", "uuid", "x.name"],
      ["FinancialEmailTemplate", "financial_email_templates", "uuid", "x.name"],
      ["FinancialGroup", "financial_groups", "uuid", "x.name"],
      [
        "FinancialGroupPermissionSet",
        "financial_group_permission_sets",
        "uuid",
        "NULL",
      ],
      [
        "FinancialInstitutionProduct",
        "financial_institution_products",
        "id",
        "x.title",
      ],
      ["FinancialPermissionSet", "financial_permission_sets", "uuid", "x.name"],
      [
        "FinancialPlaidIdvTemplate",
        "financial_plaid_idv_templates",
        "uuid",
        "NULL",
      ],
      ["FinancialUser", "financial_users", "id", "NULL"],
      ["FinancialUserGroup", "financial_user_groups", "uuid", "NULL"],
      ["ShareCategory", "share_categories", "uuid", "x.title"],
      ["ShareProduct", "share_products", "uuid", "x.title"],
    ] as const
  ).map(([itemType, table, pk, labelExpr]) => ({
    itemTypes: [itemType],
    from: `JOIN ${table} x ON x.${pk} = s.item_id`,
    fiExpr: "x.financial_institution_id",
    labelExpr,
  })),

  // Via financial_institution_product_id.
  ...(
    [
      ["Flow", "flows", "id", "x.title"],
      ["DecisionStatus", "decision_statuses", "uuid", "x.title"],
      ["DecisionRule", "decision_rules", "uuid", "x.title"],
    ] as const
  ).map(([itemType, table, pk, labelExpr]) => ({
    itemTypes: [itemType],
    from:
      `JOIN ${table} x ON x.${pk} = s.item_id ` +
      "JOIN financial_institution_products fip ON fip.id = x.financial_institution_product_id",
    fiExpr: "fip.financial_institution_id",
    labelExpr,
  })),

  // Via flow_id -> flows -> financial_institution_products.
  ...(
    [
      [
        "FlowActionConfiguration",
        "flow_action_configurations",
        "uuid",
        "x.title",
      ],
      [
        "FlowTransformConfiguration",
        "flow_transform_configurations",
        "uuid",
        "NULL",
      ],
      ["FlowTransitionRule", "flow_transition_rules", "uuid", "x.title"],
    ] as const
  ).map(([itemType, table, pk, labelExpr]) => ({
    itemTypes: [itemType],
    from:
      `JOIN ${table} x ON x.${pk} = s.item_id ` +
      "JOIN flows fl ON fl.id = x.flow_id " +
      "JOIN financial_institution_products fip ON fip.id = fl.financial_institution_product_id",
    fiExpr: "fip.financial_institution_id",
    labelExpr,
  })),

  // core_banking_configurations.financial_institution_id is populated on only 5
  // of 516 rows — the live link runs through the credential. Coalescing the two
  // takes attribution for this type from under 1% to ~73%; the remainder are
  // configurations with no credential attached at all.
  {
    itemTypes: ["CoreBankingConfiguration"],
    from:
      "JOIN core_banking_configurations x ON x.uuid = s.item_id " +
      "LEFT JOIN core_banking_credentials cbc ON cbc.uuid = x.core_banking_credential_uuid",
    fiExpr:
      "coalesce(x.financial_institution_id, cbc.financial_institution_id)",
    labelExpr: "x.description",
  },

  // Application-level (excluded from search by default, but attributable).
  {
    itemTypes: ["OnboardingApplication"],
    from:
      "JOIN onboarding_applications x ON x.id = s.item_id " +
      "JOIN flows fl ON fl.id = x.flow_id " +
      "JOIN financial_institution_products fip ON fip.id = fl.financial_institution_product_id",
    fiExpr: "fip.financial_institution_id",
    labelExpr: "NULL",
  },

  // Two-hop.
  {
    itemTypes: ["ShareProductRate"],
    from:
      "JOIN share_product_rates x ON x.uuid = s.item_id " +
      "JOIN share_products sp ON sp.uuid = x.share_product_uuid",
    fiExpr: "sp.financial_institution_id",
    labelExpr: "x.title",
  },
  {
    itemTypes: ["FinancialPermissionSetPermission"],
    from:
      "JOIN financial_permission_set_permissions x ON x.uuid = s.item_id " +
      "JOIN financial_permission_sets ps ON ps.uuid = x.financial_permission_set_uuid",
    fiExpr: "ps.financial_institution_id",
    labelExpr: "ps.name",
  },
  {
    itemTypes: ["FinancialUserRole"],
    from:
      "JOIN financial_user_roles x ON x.uuid = s.item_id " +
      "JOIN financial_users fu ON fu.id = x.financial_user_id",
    fiExpr: "fu.financial_institution_id",
    labelExpr: "NULL",
  },
];

/**
 * item_types with no cheap path to a financial institution. Rows of these types
 * come back with fi_id null by design, not by omission — the attribution
 * coverage diagnostic treats them as expected misses.
 *
 * PdfTemplate and FinancialApplicationMappingTemplate are referenced FROM a
 * flow's settings rather than pointing at one, so resolving them would mean
 * scanning every flow's jsonb. Not worth it for ~230 rows a year.
 */
export const NO_FI_ITEM_TYPES = [
  // Audited FlowOffer uuids have no matching row in flow_offers at all — not
  // soft-deleted, absent. Seven rows a year; not worth chasing further.
  "FlowOffer",
  "PdfTemplate",
  "FinancialApplicationMappingTemplate",
  "DocusignTemplate",
  "DocusignCredential",
  "PaymentIntentConfiguration",
  "RepayConfiguration",
  "StripeSetupIntentConfiguration",
  "StripeSubscriptionConfiguration",
  "AcademyContent",
];

/**
 * Types whose change payloads carry applicant PII or secrets. Values are never
 * returned for these in any mode; only key names.
 *
 * Encryption at rest does not make them safe — it is field-level and covers SSN
 * only. A live FUAL row carries a plaintext driver's-license number, date of
 * birth, applicant name and email, and a bcrypt password hash alongside the one
 * encrypted SSN blob. We redact; we never decrypt (decryption belongs to the
 * coadmin-api module).
 */
export const PII_ITEM_TYPES = [
  "OnboardingApplication",
  "FinancialUser",
  "FinancialUserRole",
  "CoreBankingCredential",
  "DocusignCredential",
  "FinancialPlaidIdvTemplate",
];

/**
 * Excluded from search unless the caller names them explicitly. These are
 * application/runtime records rather than configuration — an applicant editing
 * their own application is not a config change, and OnboardingApplication is
 * the #2 item_type by volume, so leaving it in swamps the answer.
 */
export const DEFAULT_EXCLUDED_ITEM_TYPES = [
  "OnboardingApplication",
  "FinancialUser",
  "FinancialUserRole",
];

/**
 * Config types whose diffs are large enough that a values-mode drill-in would
 * blow the context budget. These force structural mode unless the caller
 * narrows to a few specific keys.
 */
export const LARGE_PAYLOAD_ITEM_TYPES = [
  "Flow",
  "CoreBankingConfiguration",
  "DecisionRule",
  "PdfTemplate",
  "DocusignTemplate",
  "OnboardingApplication",
];

const UUID_TEXT_RE =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

function buildAttributionUnion(): string {
  const branches = FI_ATTRIBUTION.map((b) => {
    const types = b.itemTypes.map((t) => `'${t}'`).join(", ");
    return `  SELECT s.trail, s.id, ${b.fiExpr} AS fi_id, ${b.labelExpr} AS item_label
  FROM scoped s ${b.from}
  WHERE s.item_type IN (${types})`;
  });

  // Second chance for destroy events: the target row is gone, so the joins
  // above all miss. PaperTrail's `object` snapshot still holds the pre-delete
  // state. Only destroy rows touch `object`, so this detoasts almost nothing.
  branches.push(`  SELECT s.trail, s.id,
         (v.object->>'financial_institution_id')::uuid AS fi_id,
         NULL AS item_label
  FROM scoped s
  JOIN versions v ON v.id = s.id
  WHERE s.trail = 'internal'
    AND s.event = 'destroy'
    AND v.object->>'financial_institution_id' ~* '${UUID_TEXT_RE}'
  UNION ALL
  SELECT s.trail, s.id,
         (l.object->>'financial_institution_id')::uuid AS fi_id,
         NULL AS item_label
  FROM scoped s
  JOIN financial_user_audit_logs l ON l.id = s.id
  WHERE s.trail = 'portal'
    AND s.event = 'destroy'
    AND l.object->>'financial_institution_id' ~* '${UUID_TEXT_RE}'`);

  return branches.join("\n  UNION ALL\n");
}

/**
 * The `scoped` CTE: both trails, filtered on date / item_type / event / actor /
 * trail before anything joins. Everything downstream works off this.
 *
 *   $1 start (timestamptz, inclusive)
 *   $2 end   (timestamptz, exclusive)
 *   $3 item_types          text[] or NULL for no filter
 *   $4 events              text[] or NULL
 *   $5 internal actor ids  text[] (admins.id as text, '' for system) or NULL
 *   $6 portal actor ids    uuid[] or NULL
 *   $7 fi_id               uuid or NULL
 *   $8 trail               'both' | 'internal' | 'portal'
 *   $9 excluded item_types text[] or NULL
 *   $10 max rows (search only)
 */
const SCOPED_CTE = `
WITH scoped AS (
  SELECT 'internal'::text                      AS trail,
         v.id::bigint                          AS id,
         v.item_type                           AS item_type,
         v.item_id                             AS item_id,
         v.event                               AS event,
         (v.created_at AT TIME ZONE 'UTC')     AS occurred_at,
         coalesce(nullif(v.whodunnit, ''), '') AS actor_raw,
         NULL::text                            AS ip
  FROM versions v
  WHERE $8 IN ('both', 'internal')
    AND (v.created_at AT TIME ZONE 'UTC') >= $1::timestamptz
    AND (v.created_at AT TIME ZONE 'UTC') <  $2::timestamptz
    AND ($3::text[] IS NULL OR v.item_type = ANY($3))
    AND ($9::text[] IS NULL OR v.item_type <> ALL($9))
    AND ($4::text[] IS NULL OR v.event     = ANY($4))
    AND ($5::text[] IS NULL OR coalesce(nullif(v.whodunnit, ''), '') = ANY($5))
  UNION ALL
  SELECT 'portal'::text,
         l.id::bigint,
         l.item_type,
         l.item_uuid,
         l.event,
         l.created_at,
         l.financial_user_id::text,
         l.ip
  FROM financial_user_audit_logs l
  WHERE $8 IN ('both', 'portal')
    AND l.created_at >= $1::timestamptz
    AND l.created_at <  $2::timestamptz
    AND ($3::text[] IS NULL OR l.item_type = ANY($3))
    AND ($9::text[] IS NULL OR l.item_type <> ALL($9))
    AND ($4::text[] IS NULL OR l.event     = ANY($4))
    AND ($6::uuid[] IS NULL OR l.financial_user_id = ANY($6))
),
attrib AS (
{{ATTRIBUTION}}
),
attrib_best AS (
  SELECT DISTINCT ON (trail, id) trail, id, fi_id, item_label
  FROM attrib
  ORDER BY trail, id, (fi_id IS NULL), (item_label IS NULL)
)
`;

/**
 * Lean rows for the session rollup — no jsonb, so nothing is detoasted.
 * Aggregation happens in TS (config-audit.ts) over the full result set, so this
 * is capped generously rather than paged.
 */
export const SQL_CONFIG_AUDIT_SEARCH =
  SCOPED_CTE.replace("{{ATTRIBUTION}}", () => buildAttributionUnion()) +
  `
SELECT s.trail, s.id, s.item_type, s.item_id::text AS item_id, s.event,
       s.occurred_at, s.actor_raw, s.ip,
       a.fi_id::text AS fi_id, a.item_label,
       fi.name AS fi_name
FROM scoped s
LEFT JOIN attrib_best a ON a.trail = s.trail AND a.id = s.id
LEFT JOIN financial_institutions fi ON fi.id = a.fi_id
WHERE ($7::uuid IS NULL OR a.fi_id = $7::uuid)
ORDER BY s.occurred_at DESC
LIMIT $10
`;

/** Per-item_type FI attribution coverage, for include_diagnostics. */
export const SQL_CONFIG_AUDIT_COVERAGE =
  SCOPED_CTE.replace("{{ATTRIBUTION}}", () => buildAttributionUnion()) +
  `
SELECT s.item_type,
       count(*)                                    AS rows_total,
       count(a.fi_id)                              AS rows_with_fi,
       count(*) - count(a.fi_id)                   AS rows_null_fi
FROM scoped s
LEFT JOIN attrib_best a ON a.trail = s.trail AND a.id = s.id
-- Mirrors the search filter so the diagnostic describes the same row set.
-- Also gives $7 an inferable type; it is otherwise unused in this query.
WHERE ($7::uuid IS NULL OR a.fi_id = $7::uuid)
GROUP BY s.item_type
ORDER BY rows_null_fi DESC, rows_total DESC
`;

/** How many FUAL rows in the window carry no item_uuid (see header note). */
export const SQL_FUAL_NULL_ITEM_UUID = `
SELECT count(*)::int AS null_item_uuid_rows
FROM financial_user_audit_logs
WHERE created_at >= $1::timestamptz
  AND created_at <  $2::timestamptz
  AND item_uuid IS NULL
`;

/**
 * Changed top-level keys + payload size for a specific set of row ids.
 *
 * The jsonb_typeof guard is load-bearing: jsonb_object_keys errors on a null or
 * array argument, which would fail the whole call rather than one row.
 *
 *   $1 internal (versions) ids  bigint[]
 *   $2 portal (FUAL) ids        bigint[]
 */
export const SQL_CONFIG_AUDIT_CHANGED_KEYS = `
WITH page AS (
  SELECT 'internal'::text AS trail, v.id::bigint AS id,
         v.object_changes AS changes,
         pg_column_size(v.object_changes) AS bytes
  FROM versions v
  WHERE v.id = ANY($1::bigint[])
  UNION ALL
  SELECT 'portal'::text, l.id::bigint,
         l.object_changes,
         pg_column_size(l.object_changes)
  FROM financial_user_audit_logs l
  WHERE l.id = ANY($2::bigint[])
)
SELECT p.trail, p.id, p.bytes,
       coalesce(array_agg(k.key ORDER BY k.key) FILTER (WHERE k.key IS NOT NULL), '{}') AS changed_keys
FROM page p
LEFT JOIN LATERAL jsonb_object_keys(
  CASE WHEN jsonb_typeof(p.changes) = 'object' THEN p.changes ELSE '{}'::jsonb END
) AS k(key) ON true
GROUP BY p.trail, p.id, p.bytes
`;

/** Full row for the drill-in tool. $1 = versions.id */
export const SQL_CONFIG_AUDIT_DETAIL_INTERNAL = `
SELECT 'internal'::text AS trail, v.id::bigint AS id, v.item_type,
       v.item_id::text AS item_id, v.event,
       (v.created_at AT TIME ZONE 'UTC') AS occurred_at,
       coalesce(nullif(v.whodunnit, ''), '') AS actor_raw,
       NULL::text AS ip,
       v.object_changes,
       pg_column_size(v.object_changes) AS bytes
FROM versions v
WHERE v.id = $1::bigint
`;

/** Full row for the drill-in tool. $1 = financial_user_audit_logs.id */
export const SQL_CONFIG_AUDIT_DETAIL_PORTAL = `
SELECT 'portal'::text AS trail, l.id::bigint AS id, l.item_type,
       l.item_uuid::text AS item_id, l.event,
       l.created_at AS occurred_at,
       l.financial_user_id::text AS actor_raw,
       l.ip,
       l.object_changes,
       pg_column_size(l.object_changes) AS bytes
FROM financial_user_audit_logs l
WHERE l.id = $1::bigint
`;

// ── Sysadmin classification ─────────────────────────────────────────────────
//
// Mirrors dreambigger's canonical check,
// packages/acquire-api/src/utils/hasSysadminAccess.ts: a financial_user is a
// Cotribute sysadmin when their email login_id matches an `admins` row that
// holds the "[Acquire] Applications Portal" permission group via
// admin_permissions → permission_groups.
//
// Deliberately NOT email-domain based. The domain would be a shortcut, and it
// would be wrong in both directions — it labels plus-addressed test accounts as
// staff, and it labels nothing correctly that this rule doesn't already get.
//
// Known limitation to surface in notes[], not to paper over: a handful of
// pre-sysadmin-era shared accounts (notably support@cotributemail.com, the
// single busiest portal actor) have no `admins` row at all and therefore
// classify as `client`. That construct predates the permission model and the
// individuals behind it are not recoverable from the data.
export const SYSADMIN_PERMISSION_GROUP = "[Acquire] Applications Portal";

const SYSADMIN_EMAILS_CTE_BODY = `
  SELECT lower(a.email) AS email, a.id AS admin_id
  FROM admins a
  WHERE EXISTS (
    SELECT 1 FROM admin_permissions ap
    JOIN permission_groups pg ON pg.id = ap.permission_group_id
    WHERE ap.admin_id = a.id
      AND pg.name = '${SYSADMIN_PERMISSION_GROUP}'
  )`;

/** Every current sysadmin, for labelling actors outside the directory tool. */
export const SQL_SYSADMIN_EMAILS = `
WITH sysadmin_emails AS (${SYSADMIN_EMAILS_CTE_BODY}
)
SELECT email, admin_id::text AS admin_id FROM sysadmin_emails
`;

// ── Actor directory ─────────────────────────────────────────────────────────
//
// `admins` has only (id, email) — no name columns — so a display name for an
// internal actor has to come from the portal trail, matched on
// financial_users.login_id = admins.email. Where that fails we title-case the
// email local part and mark the name as a heuristic.

/**
 * Internal-trail activity per whodunnit.
 *   $1 start, $2 end, $3 fi_id filter (uuid) or NULL
 */
export const SQL_AUDIT_ACTORS_INTERNAL =
  SCOPED_CTE.replace("{{ATTRIBUTION}}", () => buildAttributionUnion()) +
  `
SELECT s.actor_raw,
       ad.id::text  AS admin_id,
       ad.email     AS admin_email,
       count(*)                      AS rows,
       min(s.occurred_at)            AS first_at,
       max(s.occurred_at)            AS last_at,
       count(DISTINCT a.fi_id)       AS fi_count,
       (array_agg(DISTINCT s.item_type))[1:20] AS item_types,
       (array_agg(DISTINCT fi.name) FILTER (WHERE fi.name IS NOT NULL))[1:20] AS fi_names
FROM scoped s
LEFT JOIN attrib_best a ON a.trail = s.trail AND a.id = s.id
LEFT JOIN financial_institutions fi ON fi.id = a.fi_id
LEFT JOIN admins ad ON ad.id::text = nullif(s.actor_raw, '')
WHERE s.trail = 'internal'
  AND ($7::uuid IS NULL OR a.fi_id = $7::uuid)
GROUP BY s.actor_raw, ad.id, ad.email
ORDER BY rows DESC
`;

/**
 * Portal-trail activity per financial_user, with the actor's own FI and role
 * strings. Note the role is NOT a reliable internal/client discriminator —
 * Cotribute staff usually have no role row at all, and where they do it is the
 * same `portalAdmin` value client staff carry. It is returned as raw data.
 *
 *   $1 start, $2 end, $7 fi_id filter (uuid) or NULL
 */
export const SQL_AUDIT_ACTORS_PORTAL =
  SCOPED_CTE.replace("{{ATTRIBUTION}}", () => buildAttributionUnion()) +
  `
, sysadmin_emails AS (
  ${SYSADMIN_EMAILS_CTE_BODY}
),
actor_rows AS (
  SELECT s.actor_raw,
         count(*)           AS rows,
         min(s.occurred_at) AS first_at,
         max(s.occurred_at) AS last_at,
         (array_agg(DISTINCT s.item_type))[1:20] AS item_types,
         (array_agg(DISTINCT fi.name) FILTER (WHERE fi.name IS NOT NULL))[1:20] AS fi_names
  FROM scoped s
  LEFT JOIN attrib_best a ON a.trail = s.trail AND a.id = s.id
  LEFT JOIN financial_institutions fi ON fi.id = a.fi_id
  WHERE s.trail = 'portal'
    AND ($7::uuid IS NULL OR a.fi_id = $7::uuid)
  GROUP BY s.actor_raw
)
SELECT ar.actor_raw,
       ar.rows, ar.first_at, ar.last_at, ar.item_types, ar.fi_names,
       fu.login_id, fu.login_id_type, fu.first_name, fu.last_name,
       fu.financial_institution_id::text AS actor_fi_id,
       afi.name AS actor_fi_name,
       (sa.admin_id IS NOT NULL) AS is_sysadmin,
       sa.admin_id::text AS admin_id,
       (SELECT array_agg(DISTINCT r.name)
          FROM financial_user_roles ur
          JOIN financial_roles r ON r.uuid = ur.financial_role_uuid
         WHERE ur.financial_user_id = fu.id) AS roles
FROM actor_rows ar
LEFT JOIN financial_users fu ON fu.id = ar.actor_raw::uuid
LEFT JOIN financial_institutions afi ON afi.id = fu.financial_institution_id
LEFT JOIN sysadmin_emails sa
       ON fu.login_id_type = 'email' AND sa.email = lower(fu.login_id)
ORDER BY ar.rows DESC
`;

/**
 * Resolve an actor_query (name fragment, email fragment, admins.id, or a
 * financial_users.id) to the id sets each trail needs.
 *   $1 = '%query%'   $2 = raw query
 */
export const SQL_RESOLVE_ACTOR = `
SELECT
  (SELECT array_agg(DISTINCT id::text)
     FROM admins
    WHERE email ILIKE $1
       OR ($2 ~ '^[0-9]+$' AND id::text = $2)
       OR lower(email) IN (
            SELECT lower(login_id) FROM financial_users
             WHERE login_id ILIKE $1
                OR (first_name || ' ' || last_name) ILIKE $1
          )
  ) AS admin_ids,
  (SELECT array_agg(DISTINCT id)
     FROM financial_users
    WHERE login_id ILIKE $1
       OR (first_name || ' ' || last_name) ILIKE $1
       OR ($2 ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND id = $2::uuid)
       OR lower(login_id) IN (SELECT lower(email) FROM admins WHERE email ILIKE $1)
  ) AS financial_user_ids,
  (SELECT array_agg(DISTINCT lower(login_id))
     FROM financial_users
    WHERE login_id ILIKE $1
       OR (first_name || ' ' || last_name) ILIKE $1
  ) AS emails
`;

/** FI resolution for the optional fi_query filter, with the same shape the
 *  fgp battery uses. `meta` is included for callers that need brand info. */
export const SQL_RESOLVE_FI_BY_UUID = `
SELECT id, name, slug, meta FROM financial_institutions WHERE id = $1
`;

export const SQL_RESOLVE_FI_BY_TEXT = `
SELECT id, name, slug, meta
FROM financial_institutions
WHERE name ILIKE $1 OR slug ILIKE $1
ORDER BY name
LIMIT 10
`;
