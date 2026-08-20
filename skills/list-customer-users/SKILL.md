---
name: list-customer-users
description: Generate the list of Cotribute customer users — the FI staff / portal users we email — as a Customer.io-import-ready CSV. Runs the `db_list_customer_users` MCP tool against the production replica, which returns one row per financial_users record holding at least one role (portalUser / portalAdmin / analyst), with the FI and roles attached as segmentation attributes, then writes the CSV verbatim to the user's workspace. Use when someone asks for the customer user list, the client contact list, "everyone with a portal login", or an email/broadcast list to import into Customer.io. Triggers: "get me the list of customer users", "who can I email about the new release", "export portal users for a CIO broadcast", "customer user list for Atlanta Postal".
---

# List Customer Users (Cowork)

Produces the **customer user list** the team imports into Customer.io to send a product broadcast. One MCP call, one CSV file written to the user's workspace folder.

## What a "customer user" is (read first)

A **`financial_users` row that holds at least one role.** That means FI staff and portal users — **not applicants**. The distinction matters enormously: `financial_users` has ~433,000 rows overall, but only ~1,400 hold a role. The role predicate is the whole definition; the tool enforces it and there is no way to switch it off.

Roles in use today: `portalUser`, `portalAdmin`, `analyst`.

## Step 1 — call the tool

```
db_list_customer_users({})
```

That is the normal call. **With no arguments it returns the raw list** — every role-holder at every FI, including internal `@cotribute` accounts and unverified logins, with no dedupe. That default is deliberate; see the guardrail below before you change it.

Optional arguments, all opt-in:

| Argument | Type | Effect |
| --- | --- | --- |
| `fi_query` | string | Scope to one FI — name fragment, slug, or uuid |
| `roles` | string[] | Only users holding one of these roles |
| `verified_only` | boolean | Only `login_verified = true` |
| `exclude_internal` | boolean | Drop `@cotribute*` logins (our own staff) |
| `dedupe_by_email` | boolean | One row per email; a person at several FIs folds into one row |
| `limit` | number | Cap rows (1–20000). Omit for the full list |
| `env` | `"prod"` \| `"sandbox"` | Defaults to `prod` |

### Three possible responses

| Shape | Meaning | What to do |
| --- | --- | --- |
| `{ ok: false, error }` | No FI matched, or an unknown role name was passed | Show the error; the error text lists the known role names |
| `{ ambiguous: true, candidates: [...] }` | `fi_query` matched several FIs | Show the candidates and ask which one |
| `{ ok: true, ... }` | Success | Continue to Step 2 |

### Success payload

| Field | Type | Notes |
| --- | --- | --- |
| `ok` | boolean | Always `true` on this shape |
| `generated_at` | string | `YYYY-MM-DD`, for the filename |
| `fi` | object \| null | `{ id, name, slug }` when `fi_query` resolved, else `null` |
| `filters_applied` | object | Echo of every filter — caption the file with this |
| `total` | number | Row count, excluding the header line |
| `columns` | string[] | `id, email, first_name, last_name, fi_slug, fi_name, roles` |
| `by_fi` | array | `{ fi_slug, users }`, descending — use it for the summary |
| `rows_csv` | string | **Final CSV text**, header row included, CRLF line endings |
| `truncated` | boolean | `true` only if a backstop fired; see `note` |
| `note` | string | Present only when `truncated` — says how to narrow |

## Step 2 — write the file

Write `rows_csv` to `Customer Users <generated_at>.csv` **byte-for-byte, exactly as returned.**

Do not parse it, do not round-trip it through pandas or a CSV library, do not re-encode it, do not "clean up" the line endings. The server already emitted final RFC-4180 CSV with the CRLF endings Customer.io's importer expects; every transformation from here is a chance to shift a column or mangle a quoted name and no chance to improve anything.

If `fi` is set, name the file `Customer Users — <fi.name> <generated_at>.csv`.

## Step 3 — report back

State, briefly:

- `total` rows written and the filename
- the top few FIs from `by_fi`
- which filters were applied (from `filters_applied`) — and, when they were all off, say so explicitly

## Step 4 — the Customer.io import note

Include this with the deliverable:

- **`id`** is the CIO identifier column (the `financial_users` UUID — stable across imports, so re-importing updates people rather than duplicating them).
- **`email`**, **`first_name`**, **`last_name`** are standard CIO attributes.
- **`fi_slug`**, **`fi_name`**, **`roles`** ride along as custom attributes — these are what you segment a broadcast on (by credit union, or `portalAdmin` vs `portalUser`). `roles` and, after dedupe, `fi_slug`/`fi_name` are semicolon-delimited when a person has more than one value.

## Guardrail — before a real broadcast

The default output is the **raw** list. Do not silently filter it, and do not silently leave it unfiltered either. When the request is clearly headed for an actual send, state the numbers and offer the three filters:

- **`exclude_internal`** — ~83 rows are internal Cotribute staff accounts sitting inside client tenants. Almost always wrong to include in a customer product email.
- **`dedupe_by_email`** — ~16 emails appear on more than one row (the same person at multiple FIs). Without this, those people get the broadcast twice.
- **`verified_only`** — ~256 rows have never verified their login. Including them is fine for a product announcement, less fine if deliverability is a concern.

Let the requester decide. Re-run the tool with their choices rather than editing the CSV.

## Notes

- `financial_users` has **no** `deleted_at` column, so there is no soft-delete filter. Nobody is excluded on those grounds and the list cannot be filtered that way — say so if asked.
- `login_id_type` is `email` for 100% of role-holders today. `login_id` is aliased straight to `email`; the tool does not filter on the type, so a future phone-login user would appear with a non-email `email` value rather than vanishing.
- The Claude Code equivalent is a hand-run query against `yarn db:replica` in the `dreambigger` repo. There is no mirrored agent file for this one — this skill is the only packaged edition.
