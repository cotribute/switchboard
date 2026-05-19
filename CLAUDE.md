# Switchboard

Cotribute's MCP server — exposes Front.app and Pipedrive tools to Claude (Code + Cowork).

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
  server.ts             # CotributeMCPServer — merges tools from all modules
  frontapp/
    tools.ts            # Front.app tool definitions (142 tools)
    handlers.ts         # Front.app handlers (axios → api2.frontapp.com)
  pipedrive/
    tools.ts            # Pipedrive tool definitions (55 tools)
    handlers.ts         # Pipedrive handlers (axios → {domain}.pipedrive.com/api/v1)
  google-analytics/
    tools.ts            # Google Analytics tool definitions (6 tools)
    handlers.ts         # GA handlers (axios → analyticsdata/analyticsadmin.googleapis.com)
  customerio/
    tools.ts            # Customer.io tool definitions (25 tools)
    handlers.ts         # Customer.io handlers (axios → api.customer.io/v1)
  heroku-postgres/
    tools.ts            # Direct-DB read tools (12 tools — user/app lookup, config, slices coadmin doesn't cover)
    handlers.ts         # Handlers (pg.Pool × 2 — prod + sandbox; pools are module-level singletons in index.ts)
  coadmin-api/
    tools.ts            # coadmin-api sysadmin read tools (16 tools, decrypts ciphertext columns)
    handlers.ts         # Handlers (axios → DREAMBIGGER_API_BASE_URL with X-Cotribute-Api-* headers)
  papertrail/
    tools.ts            # Papertrail tools (2 tools)
    handlers.ts         # Handlers (axios → papertrailapp.com)
  github/
    tools.ts            # GitHub tools (3 tools)
    handlers.ts         # Handlers (axios → api.github.com)
```

**How modules compose:** Each module exports a `tools` array and a `createHandlers(axiosInstance)` function. `server.ts` merges them into a single MCP Server with one `ListToolsRequestSchema` and one `CallToolRequestSchema` handler that dispatches via a merged handler map.

Pipedrive tools are only registered when `PIPEDRIVE_API_TOKEN` and `PIPEDRIVE_DOMAIN` env vars are set.

Google Analytics tools are only registered when `GOOGLE_ANALYTICS_CREDENTIALS` env var is set (base64-encoded service account JSON).

Customer.io tools are only registered when `CUSTOMERIO_API_KEY` env var is set.

## Adding a New Tool

1. Add tool definition object to `src/<module>/tools.ts`
2. Add matching handler in `src/<module>/handlers.ts`
3. That's it — `server.ts` auto-merges from both modules

## Adding a New API Module

1. Create `src/<module>/tools.ts` exporting a `tools` array
2. Create `src/<module>/handlers.ts` exporting `createHandlers(axiosInstance)`
3. Import and merge in `src/server.ts` (follow the existing pattern)

## Deployment

Deployed to Heroku app `cotribute-frontapp-mcp`. The MCP endpoint URL is unchanged for all team members:

```
https://cotribute-switchboard-93f1fbb4d273.herokuapp.com/mcp
```

```bash
git push heroku master    # Deploy to Heroku
```

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `FRONTAPP_API_TOKEN` | Yes | Front.app API Bearer token |
| `MCP_API_KEY` | No | Bearer token protecting the /mcp endpoint |
| `PIPEDRIVE_API_TOKEN` | No | Pipedrive API token |
| `PIPEDRIVE_DOMAIN` | No* | Pipedrive company subdomain (required if token is set) |
| `GOOGLE_ANALYTICS_CREDENTIALS` | No | Base64-encoded Google service account JSON for GA4 access |
| `CUSTOMERIO_API_KEY` | No | Customer.io App API key |
| `CUSTOMERIO_REGION` | No | Customer.io region: `us` (default) or `eu` |
| `CLAUDE_URL` | No | Prod read-only Postgres replica (for `/heroku-postgres/mcp`) |
| `CLAUDE_UAT_URL` | No | Sandbox Postgres (for `/heroku-postgres/mcp`) |
| `DREAMBIGGER_API_BASE_URL` | No | coadmin-api base URL (for `/coadmin-api/mcp`) |
| `ACQUIRE_API_KEY` | No | coadmin-api `X-Cotribute-Api-Key` header value |
| `ACQUIRE_API_SECRET` | No | coadmin-api `X-Cotribute-Api-Secret` header value |
| `ACQUIRE_API_CLIENT_ID` | No | coadmin-api `X-Cotribute-Client-Id` header value |
| `PAPERTRAIL_API_TOKEN` | No | Papertrail API token (for `/papertrail/mcp`) |
| `GITHUB_TOKEN` | No | GitHub fine-grained PAT (for `/github/mcp`) |
| `GITHUB_DEFAULT_ORG` | No | Default GitHub org for `github_search_code` (default: `cotribute`) |

## Support-research endpoints

Four endpoints expose tools for support engineers researching customer tickets:

```
/heroku-postgres/mcp  — direct DB reads (12 tools)
/coadmin-api/mcp      — wraps coadmin-api sysadmin GETs, decrypts ciphertext columns (16 tools)
/papertrail/mcp       — Papertrail log search (2 tools)
/github/mcp           — GitHub code search + file access (3 tools)
```

**Tool ownership is disjoint by construction** — there's exactly one tool per data type:
- coadmin-api owns everything app-scoped that touches encrypted columns: decision-status logs, API request logs, core-banking logs, FIS GKYC, financial email logs. It also owns the plaintext things it covers (effectiv, Plaid IDV, Repay payments).
- heroku-postgres owns what coadmin doesn't expose: user lookup and application discovery (the entry points; coadmin needs an application_id), config tables (flows, decision rules, FIs, products), fraud results, Vouched IDV, Stripe payments, OTP / Twilio.

Defaults: transaction tools default to `env: "prod"`; config tools default to `env: "sandbox"` (clients build and test config there before promoting). DB pools are module-level singletons in `index.ts` — shared across MCP sessions for the lifetime of the dyno.

**These four endpoints are role-level, not org-level.** Do not add them to any shared or org-wide MCP configuration. Support team members connect to them individually:
- Claude Code: add to `~/.claude/settings.json` (personal) or a project-level `mcp.json` in the support working directory
- Cowork: add as additional MCP connections in the individual team member's profile, not the org connector list

Consistent with this, the four support modules are deliberately excluded from `scope === "all"` — even if someone connects to `/mcp`, they won't see the support tools. The existing org-level endpoints (`/frontapp-lite/mcp`, `/pipedrive-lite/mcp`, etc.) are unaffected.

## Auth

The `/mcp` endpoint accepts auth via `Authorization: Bearer <token>` header or via URL path `/mcp/<token>`. If `MCP_API_KEY` is not set, auth is disabled.

## Transport

Uses `StreamableHTTPServerTransport` from the MCP SDK. Each POST without a session ID creates a new server+transport pair. Subsequent requests reuse the session via the `mcp-session-id` header.
