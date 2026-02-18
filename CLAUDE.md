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
```

**How modules compose:** Each module exports a `tools` array and a `createHandlers(axiosInstance)` function. `server.ts` merges them into a single MCP Server with one `ListToolsRequestSchema` and one `CallToolRequestSchema` handler that dispatches via a merged handler map.

Pipedrive tools are only registered when `PIPEDRIVE_API_TOKEN` and `PIPEDRIVE_DOMAIN` env vars are set.

Google Analytics tools are only registered when `GOOGLE_ANALYTICS_CREDENTIALS` env var is set (base64-encoded service account JSON).

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

## Auth

The `/mcp` endpoint accepts auth via `Authorization: Bearer <token>` header or via URL path `/mcp/<token>`. If `MCP_API_KEY` is not set, auth is disabled.

## Transport

Uses `StreamableHTTPServerTransport` from the MCP SDK. Each POST without a session ID creates a new server+transport pair. Subsequent requests reuse the session via the `mcp-session-id` header.
