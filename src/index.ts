#!/usr/bin/env node

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { Pool } from "pg";

import { CotributeMCPServer, ModuleScope } from "./server.js";

// Required env vars
const frontappToken = process.env.FRONTAPP_API_TOKEN;
if (!frontappToken) {
  console.error("Error: FRONTAPP_API_TOKEN environment variable is required");
  process.exit(1);
}

// Optional Pipedrive env vars
const pipedriveToken = process.env.PIPEDRIVE_API_TOKEN;
const pipedriveDomain = process.env.PIPEDRIVE_DOMAIN;

// Optional Google Analytics env vars
const gaCredentials = process.env.GOOGLE_ANALYTICS_CREDENTIALS;

// Optional Customer.io env vars
const customerioApiKey = process.env.CUSTOMERIO_API_KEY;
const customerioRegion = process.env.CUSTOMERIO_REGION;

if (pipedriveToken && !pipedriveDomain) {
  console.error(
    "Error: PIPEDRIVE_DOMAIN is required when PIPEDRIVE_API_TOKEN is set"
  );
  process.exit(1);
}

// Optional Dealfront env vars
const dealfrontToken = process.env.DEALFRONT_API_TOKEN;
const dealfrontIpEnrichKey = process.env.DEALFRONT_IP_ENRICH_API_KEY;

// Optional Instantly.ai env vars
const instantlyApiKey = process.env.INSTANTLY_API_KEY;

// Optional support-research env vars (role-level endpoints, not org-level)
const claudeDbUrl = process.env.CLAUDE_URL;
const claudeUatDbUrl = process.env.CLAUDE_UAT_URL;
const coadminApiBaseUrl = process.env.DREAMBIGGER_API_BASE_URL;
const acquireApiKey = process.env.ACQUIRE_API_KEY;
const acquireApiSecret = process.env.ACQUIRE_API_SECRET;
const acquireApiClientId = process.env.ACQUIRE_API_CLIENT_ID;
const papertrailToken = process.env.PAPERTRAIL_API_TOKEN;
const githubToken = process.env.GITHUB_TOKEN;

// Module-level singleton DB pools — shared across MCP sessions, lifetime of the dyno
const prodDbPool = claudeDbUrl
  ? new Pool({
      connectionString: claudeDbUrl,
      ssl: { rejectUnauthorized: false },
      max: 3,
    })
  : null;
const uatDbPool = claudeUatDbUrl
  ? new Pool({
      connectionString: claudeUatDbUrl,
      ssl: { rejectUnauthorized: false },
      max: 3,
    })
  : null;

const coadminApiCreds =
  acquireApiKey && acquireApiSecret && acquireApiClientId
    ? {
        apiKey: acquireApiKey,
        apiSecret: acquireApiSecret,
        clientId: acquireApiClientId,
      }
    : undefined;

const mcpApiKey = process.env.MCP_API_KEY;

const app = express();
app.use(express.json());

// Health check (no auth required)
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", server: "switchboard" });
});

// Auth middleware for MCP endpoint — accepts Bearer header OR token in URL path
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!mcpApiKey) {
    next();
    return;
  }
  const headerToken = req.headers.authorization?.replace("Bearer ", "");
  const pathToken = req.params.token;
  if (headerToken !== mcpApiKey && pathToken !== mcpApiKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// Track transports by session ID for stateful connections
const transports = new Map<string, StreamableHTTPServerTransport>();

// Creates an MCP handler scoped to specific modules
function createMcpHandler(scope: ModuleScope) {
  return async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "POST" && !sessionId) {
      // New session — create a new MCP server + transport pair (Server is 1:1 with transport)
      const newSessionId = randomUUID();
      const mcpServer = new CotributeMCPServer(
        frontappToken,
        pipedriveToken,
        pipedriveDomain,
        scope,
        dealfrontToken,
        dealfrontIpEnrichKey,
        gaCredentials,
        customerioApiKey,
        customerioRegion,
        instantlyApiKey,
        prodDbPool,
        uatDbPool,
        coadminApiBaseUrl,
        coadminApiCreds,
        papertrailToken,
        githubToken
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
      });

      transport.onclose = () => {
        transports.delete(newSessionId);
      };

      await mcpServer.getServer().connect(transport);

      // Store BEFORE handleRequest — handleRequest may hold the connection open for SSE
      // and not resolve, so we must register the session first.
      transports.set(newSessionId, transport);

      await transport.handleRequest(req, res, req.body);
      return;
    }

    // Existing session — look up the transport
    if (sessionId) {
      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({ error: "Missing mcp-session-id header" });
  };
}

// Lite endpoints — read-only tools for context-constrained clients (Cowork)
app.all(
  "/frontapp-lite/mcp",
  authMiddleware,
  createMcpHandler("frontapp-lite")
);
app.all(
  "/frontapp-lite/mcp/:token",
  authMiddleware,
  createMcpHandler("frontapp-lite")
);
app.all(
  "/pipedrive-lite/mcp",
  authMiddleware,
  createMcpHandler("pipedrive-lite")
);
app.all(
  "/pipedrive-lite/mcp/:token",
  authMiddleware,
  createMcpHandler("pipedrive-lite")
);
// Dealfront lite endpoint
app.all(
  "/dealfront-lite/mcp",
  authMiddleware,
  createMcpHandler("dealfront-lite")
);
app.all(
  "/dealfront-lite/mcp/:token",
  authMiddleware,
  createMcpHandler("dealfront-lite")
);
// Google Analytics endpoints
app.all(
  "/google-analytics-lite/mcp",
  authMiddleware,
  createMcpHandler("google-analytics-lite")
);
app.all(
  "/google-analytics-lite/mcp/:token",
  authMiddleware,
  createMcpHandler("google-analytics-lite")
);
app.all(
  "/google-analytics/mcp",
  authMiddleware,
  createMcpHandler("google-analytics")
);
app.all(
  "/google-analytics/mcp/:token",
  authMiddleware,
  createMcpHandler("google-analytics")
);
// Customer.io endpoints
app.all(
  "/customerio-lite/mcp",
  authMiddleware,
  createMcpHandler("customerio-lite")
);
app.all(
  "/customerio-lite/mcp/:token",
  authMiddleware,
  createMcpHandler("customerio-lite")
);
app.all("/customerio/mcp", authMiddleware, createMcpHandler("customerio"));
app.all(
  "/customerio/mcp/:token",
  authMiddleware,
  createMcpHandler("customerio")
);
// Instantly.ai endpoints
app.all(
  "/instantly-lite/mcp",
  authMiddleware,
  createMcpHandler("instantly-lite")
);
app.all(
  "/instantly-lite/mcp/:token",
  authMiddleware,
  createMcpHandler("instantly-lite")
);
app.all("/instantly/mcp", authMiddleware, createMcpHandler("instantly"));
app.all("/instantly/mcp/:token", authMiddleware, createMcpHandler("instantly"));
// Support-research endpoints (role-level — not included in /mcp scope="all")
app.all(
  "/heroku-postgres/mcp",
  authMiddleware,
  createMcpHandler("heroku-postgres")
);
app.all(
  "/heroku-postgres/mcp/:token",
  authMiddleware,
  createMcpHandler("heroku-postgres")
);
app.all("/coadmin-api/mcp", authMiddleware, createMcpHandler("coadmin-api"));
app.all(
  "/coadmin-api/mcp/:token",
  authMiddleware,
  createMcpHandler("coadmin-api")
);
app.all("/papertrail/mcp", authMiddleware, createMcpHandler("papertrail"));
app.all(
  "/papertrail/mcp/:token",
  authMiddleware,
  createMcpHandler("papertrail")
);
app.all("/github/mcp", authMiddleware, createMcpHandler("github"));
app.all("/github/mcp/:token", authMiddleware, createMcpHandler("github"));
// Full scoped endpoints
app.all("/frontapp/mcp", authMiddleware, createMcpHandler("frontapp"));
app.all("/frontapp/mcp/:token", authMiddleware, createMcpHandler("frontapp"));
app.all("/pipedrive/mcp", authMiddleware, createMcpHandler("pipedrive"));
app.all("/pipedrive/mcp/:token", authMiddleware, createMcpHandler("pipedrive"));
app.all("/dealfront/mcp", authMiddleware, createMcpHandler("dealfront"));
app.all("/dealfront/mcp/:token", authMiddleware, createMcpHandler("dealfront"));
// All tools (backwards compatible)
app.all("/mcp", authMiddleware, createMcpHandler("all"));
app.all("/mcp/:token", authMiddleware, createMcpHandler("all"));

const port = parseInt(process.env.PORT || "3000", 10);
app.listen(port, () => {
  const services = ["Front.app"];
  if (pipedriveToken) services.push("Pipedrive");
  if (dealfrontToken) services.push("Dealfront");
  if (gaCredentials) services.push("Google Analytics");
  if (customerioApiKey) services.push("Customer.io");
  if (instantlyApiKey) services.push("Instantly");
  if (prodDbPool) services.push("Heroku Postgres (prod)");
  if (uatDbPool) services.push("Heroku Postgres (sandbox)");
  if (coadminApiBaseUrl && coadminApiCreds) services.push("coadmin-api");
  if (papertrailToken) services.push("Papertrail");
  if (githubToken) services.push("GitHub");
  console.log(
    `Switchboard MCP server listening on port ${port} (${services.join(" + ")})`
  );
});
