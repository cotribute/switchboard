// SQL for the /list-customer-users Cowork skill.
//
// Provenance: Arvind's hand-run query for "the list of customer users we email"
//   select financial_users.id, financial_users.login_id as email,
//          financial_users.first_name, financial_users.last_name
//   from financial_users
//   where exists (select 1 from financial_user_roles
//                 where financial_users.id = financial_user_roles.financial_user_id)
//   order by financial_users.first_name, financial_users.last_name
//
// A "customer user" is a financial_users row holding at least one role — i.e.
// FI staff / portal users, NOT applicants. The role predicate is what keeps
// this at ~1.4k rows; financial_users itself has 433k rows, so never drop it.
//
// Params:
//   $1 = fi_id (uuid) or NULL for all FIs
//   $2 = role names (text[]) or NULL for all roles
//   $3 = verified_only (boolean) — true restricts to login_verified
//   $4 = exclude_internal (boolean) — true drops @cotribute* logins
//   $5 = row limit (int) or NULL for no limit
//
// Column set is deliberately Customer.io-import-shaped: `id` is the CIO
// identifier, email/first_name/last_name are the standard attributes, and
// fi_slug/fi_name/roles ride along as segmentation attributes.
//
// Quirks to preserve:
//   - financial_user_roles joins financial_roles on `.financial_role_uuid` =
//     `financial_roles.uuid`. financial_roles has NO `id` column. (Same join
//     used in config-audit-sql.ts.)
//   - financial_users has NO `deleted_at` column — there is no soft-delete
//     filter to apply here, don't invent one.
//   - Roles are rolled up by a correlated subquery rather than a GROUP BY so a
//     multi-role user stays exactly one row (one CSV line = one CIO person).
//   - login_id_type is 100% 'email' for role-holders today, so login_id is
//     aliased straight to `email`; we don't filter on the type, which keeps a
//     future phone-login row visible rather than silently dropping it.
//   - ORDER BY first_name, last_name is carried over from the source query.
//   - Names/emails are btrim'd and empty-string-to-NULL'd. 68 role-holders have
//     padded names in prod; untrimmed, a CIO merge tag renders "Hi Alexandria ,"
//     in the broadcast. This normalizes the value, never which rows appear.

export const SQL_CUSTOMER_USERS = `
SELECT fu.id,
       nullif(btrim(fu.login_id), '') AS email,
       nullif(btrim(fu.first_name), '') AS first_name,
       nullif(btrim(fu.last_name), '') AS last_name,
       fi.slug AS fi_slug,
       fi.name AS fi_name,
       (SELECT string_agg(r.name, ';' ORDER BY r.name)
          FROM financial_user_roles ur
          JOIN financial_roles r ON r.uuid = ur.financial_role_uuid
         WHERE ur.financial_user_id = fu.id) AS roles,
       fu.login_verified,
       fu.created_at
FROM financial_users fu
JOIN financial_institutions fi ON fi.id = fu.financial_institution_id
WHERE EXISTS (
        SELECT 1
          FROM financial_user_roles ur
          JOIN financial_roles r ON r.uuid = ur.financial_role_uuid
         WHERE ur.financial_user_id = fu.id
           AND ($2::text[] IS NULL OR r.name = ANY($2::text[]))
      )
  AND ($1::uuid IS NULL OR fu.financial_institution_id = $1::uuid)
  AND (NOT $3::boolean OR fu.login_verified)
  AND (NOT $4::boolean OR fu.login_id NOT ILIKE '%@cotribute%')
ORDER BY btrim(fu.first_name), btrim(fu.last_name)
LIMIT $5::int
`;

// Role names that exist in financial_roles. Used to reject typo'd `roles`
// values with a clear error instead of silently returning zero rows.
export const SQL_KNOWN_ROLE_NAMES = `SELECT name FROM financial_roles ORDER BY name`;
