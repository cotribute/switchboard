# Switchboard

Cotribute's MCP server — exposes per-team integration tools to Claude (Code + Cowork). One scope per endpoint, one connector per integration.

## Development Commands

```bash
npm run build          # Compile TypeScript
npm run dev            # Build + start locally
npm run lint           # ESLint check
npm run lint:fix       # ESLint auto-fix
npm run format         # Prettier auto-format
npm run format:check   # Prettier check only
```

## Architecture

```
src/
  index.ts              # Express server, auth middleware, session/transport management
  server.ts             # CotributeMCPServer — wires one module's tools+handlers per request
  frontapp/             # 15 tools — Front.app conversations, contacts, analytics, accounts
  pipedrive/            # 24 tools — Pipedrive deals, persons, organizations, activities, notes, leads
  dealfront/            # 10 tools — Dealfront/Leadfeeder accounts, leads, visits, IP enrich
  google-analytics/     # 3 tools — GA4 account summaries, reports, metadata
  customerio/           # 12 tools — Customer.io customers, segments, campaigns, newsletters
  instantly/            # 18 tools — Instantly.ai campaigns, leads, accounts, emails
  heroku-postgres/      # 32 tools — Direct prod/sandbox DB reads (CX support) + business-outcomes battery + config-change audit + customer-user list
  coadmin-api/          # 16 tools — coadmin-api sysadmin reads with ciphertext decryption (CX support)
  papertrail/           # 2 tools  — Papertrail log search (CX support)
  github/               # 3 tools  — Cotribute monorepo code search + file access (CX support)
```

**How modules compose:** Each module exports a `tools` array and a `createHandlers(axiosInstance)` function. `server.ts` is scope-aware — only one module's tools and handlers are loaded per request, based on the URL path. Endpoint URL → scope → module exposed is 1:1.

All integrations are read-only. Each module is only registered when its env var(s) are set; missing creds → the endpoint returns an empty tool list rather than failing.

## Endpoints

```
/frontapp/mcp          — CX team (Front conversations + contacts)
/customerio/mcp        — CX team (Customer.io reads, rare use)
/dealfront/mcp         — GTM team
/pipedrive/mcp         — GTM team
/google-analytics/mcp  — GTM team
/instantly/mcp         — GTM team
/heroku-postgres/mcp   — CX support, per-individual (not org-wide)
/coadmin-api/mcp       — CX support, per-individual
/papertrail/mcp        — CX support, per-individual
/github/mcp            — CX support, per-individual (Cotribute monorepo only)
```

All endpoints accept auth via `Authorization: Bearer <token>` header OR `:token` in the URL path. Token must match `MCP_API_KEY` (auth disabled if unset).

## Cowork connector setup

| Scope                  | Connectors                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| Org-level (everyone)   | Gmail, Google Calendar, Google Drive, Slack                                                       |
| GTM team               | `/dealfront/mcp`, `/pipedrive/mcp`, `/google-analytics/mcp`, `/instantly/mcp` (Switchboard)       |
| CX team                | `/frontapp/mcp`, `/customerio/mcp` (Switchboard) + Anthropic GitHub Integration (general-purpose) |
| CX individual profiles | `/heroku-postgres/mcp`, `/coadmin-api/mcp`, `/papertrail/mcp`, `/github/mcp` (Switchboard)        |

The CX support endpoints (heroku-postgres, coadmin-api, papertrail, github) are deliberately per-individual: they access prod data, decrypt ciphertext, and read production logs. Do not add them to any shared org-wide configuration.

The Switchboard `/github/mcp` is scoped to the Cotribute monorepo (bot PAT, defaults to `GITHUB_DEFAULT_ORG`). It complements — does not replace — Anthropic's GitHub Integration, which uses user OAuth for general GitHub access.

## Support-research tool ownership

Tool ownership across the four CX support endpoints is disjoint by construction — there's exactly one tool per data type:

- **coadmin-api** owns everything app-scoped that touches encrypted columns: decision-status logs, API request logs, core-banking logs, FIS GKYC, financial email logs. It also owns the plaintext things it covers (effectiv, Plaid IDV, Repay payments).
- **heroku-postgres** owns what coadmin doesn't expose: entry-point lookup (financial_users / onboarding_applications / FIs); config tables (flows + their action/transform/routing/offer/prefill internals, decision_statuses + decision_rules, FI products, share_categories/products, financial_application_mapping_templates, core_banking_configurations); transaction snapshots (financial_applications, fraud results + reasons, OFAC watchlist, credit report metadata + corelation pulls, business verification (Middesk + FIS product), Vouched IDV, Stripe payments, OTP / Twilio); plus a small legacy bridge (organizations.meta lookup, submissions → onboarding_applications resolution); plus one Cowork-skill battery (`db_business_outcomes_battery`) that bundles 10 aggregate queries for the `/generate-business-outcomes` skill into a single round-trip — see `skills/generate-business-outcomes/SKILL.md` and `src/heroku-postgres/business-outcomes-sql.ts`; plus one CSV-export tool (`db_list_customer_users`) backing the `/list-customer-users` skill, which returns the Customer.io-import-ready list of FI staff/portal users (financial_users holding >=1 role) as final CSV text rather than row objects — see `skills/list-customer-users/SKILL.md` and `src/heroku-postgres/customer-users-sql.ts`.

It also owns **config-change history** (`db_audit_actors`, `db_config_audit_search`,
`db_config_audit_detail`) over the two audit trails: `versions` (PaperTrail, written by
the coadmin Rails back office — Cotribute sysadmins) and `financial_user_audit_logs`
(written by settings-api/boa-settings — Cotribute staff and FI staff alike). These answer
"who changed what, for which FI, when". Three things about them are deliberate:

- **They redact, never decrypt** — so they stay on the right side of the ownership
  boundary above. Field-level encryption covers the SSN and nothing else; names, dates of
  birth, document numbers and password hashes sit in the clear in `object_changes`, so
  values are denylisted by key and by value shape, application-level item types are
  excluded by default, and values are withheld entirely for PII-bearing types.
- **Sysadmin vs client comes from the permission model, not the email domain** — an
  `admins` row holding the "[Acquire] Applications Portal" group, mirroring
  `packages/acquire-api/src/utils/hasSysadminAccess.ts` in dreambigger.
- **They default to `env: "prod"`** even though they are config-shaped, because audit
  questions are about what happened to the live configuration and FI staff only exist in
  the prod portal.

`legacy_model_versions` is intentionally out of scope: same PaperTrail schema, but it holds
the integer-PK legacy WeServe models (Pulse, EmailMetric, Token, Bucket) — 4.8M rows of
runtime data and zero Acquire config.

Transaction tools default to `env: "prod"`; config tools default to `env: "sandbox"` (clients build and test config there before promoting). DB pools are module-level singletons in `index.ts` — shared across MCP sessions for the lifetime of the dyno.

## Skills

`skills/` holds the Cowork skills that use these endpoints. Anthropic's standard layout, one directory per skill: `skills/<name>/SKILL.md`, YAML frontmatter with `name` (matching the directory) and `description` required, supporting files (`assets/`, `evals/`) alongside.

| Skill | Backed by | What it produces |
| --- | --- | --- |
| `generate-business-outcomes` | `db_business_outcomes_battery` | Per-FI business-outcomes markdown → `.docx` |
| `generate-fgp-utilization` | `db_fgp_utilization_battery` | FraudGuard+ billable-inquiry workbook (`.xlsx`) for finance |
| `list-customer-users` | `db_list_customer_users` | Customer.io-import-ready CSV of FI staff / portal users |
| `help` | frontapp + heroku-postgres + coadmin-api + papertrail + github | Support triage: internal diagnosis + drafted customer reply |
| `cotribute-brand` | none — assets only | Brand rules + logo files for on-brand deliverables |

Most skills are 1 skill ↔ 1 battery tool, one round-trip. Two are not: `help` spans five scopes (a session needs each connector it reaches for), and `cotribute-brand` calls no tool at all — it ships the logo set in `assets/logos/` and the palette/typography rules.

Skills are distributed as `.skill` bundles (zip archives of the same directory). **The unpacked directory is the source of truth here** — `*.skill` is gitignored so a downloaded bundle can't land in the tree as an opaque binary. To publish, re-zip the directory; to adopt an updated bundle, unpack it over the directory and commit the diff.

## Adding a New Tool

1. Add tool definition object to `src/<module>/tools.ts`
2. Add matching handler in `src/<module>/handlers.ts`
3. That's it — `server.ts` picks both up automatically

## Adding a New API Module

1. Create `src/<module>/tools.ts` exporting a `tools` array
2. Create `src/<module>/handlers.ts` exporting `createHandlers(axiosInstance)`
3. Import in `src/server.ts`, add the scope string to `ModuleScope`, wire the `if (scope === ...)` block
4. Add the scope to the `moduleEndpoints` array in `src/index.ts`

## Deployment

Deployed to Heroku app `cotribute-switchboard` at:

```
https://switchboard.cotribute.co
```

```bash
git push heroku master    # Deploy to Heroku
```

## Environment Variables

| Variable                       | Required | Purpose                                                             |
| ------------------------------ | -------- | ------------------------------------------------------------------- |
| `FRONTAPP_API_TOKEN`           | Yes      | Front.app API Bearer token                                          |
| `MCP_API_KEY`                  | No       | Bearer token protecting all `/<module>/mcp` endpoints               |
| `PIPEDRIVE_API_TOKEN`          | No       | Pipedrive API token                                                 |
| `PIPEDRIVE_DOMAIN`             | No\*     | Pipedrive company subdomain (required if token is set)              |
| `DEALFRONT_API_TOKEN`          | No       | Dealfront/Leadfeeder API token                                      |
| `DEALFRONT_IP_ENRICH_API_KEY`  | No       | Dealfront IP enrichment key (optional, gates `dealfront_enrich_ip`) |
| `GOOGLE_ANALYTICS_CREDENTIALS` | No       | Base64-encoded Google service account JSON for GA4 access           |
| `CUSTOMERIO_API_KEY`           | No       | Customer.io App API key                                             |
| `CUSTOMERIO_REGION`            | No       | Customer.io region: `us` (default) or `eu`                          |
| `INSTANTLY_API_KEY`            | No       | Instantly.ai V2 API key                                             |
| `CLAUDE_URL`                   | No       | Prod read-only Postgres replica (for `/heroku-postgres/mcp`)        |
| `CLAUDE_UAT_URL`               | No       | Sandbox Postgres (for `/heroku-postgres/mcp`)                       |
| `DREAMBIGGER_API_BASE_URL`     | No       | coadmin-api base URL (for `/coadmin-api/mcp`)                       |
| `ACQUIRE_API_KEY`              | No       | coadmin-api `X-Cotribute-Api-Key` header value                      |
| `ACQUIRE_API_SECRET`           | No       | coadmin-api `X-Cotribute-Api-Secret` header value                   |
| `ACQUIRE_API_CLIENT_ID`        | No       | coadmin-api `X-Cotribute-Client-Id` header value                    |
| `PAPERTRAIL_API_TOKEN`         | No       | Papertrail API token (for `/papertrail/mcp`)                        |
| `GITHUB_TOKEN`                 | No       | GitHub fine-grained PAT (for `/github/mcp`)                         |
| `GITHUB_DEFAULT_ORG`           | No       | Default GitHub org for `github_search_code` (default: `cotribute`)  |

## Transport

Uses `StreamableHTTPServerTransport` from the MCP SDK. Each POST without a session ID creates a new server+transport pair (with the scope baked in). Subsequent requests reuse the session via the `mcp-session-id` header.
