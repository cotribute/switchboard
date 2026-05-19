import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";
import { Pool } from "pg";

import { tools as frontappTools } from "./frontapp/tools.js";
import { createHandlers as createFrontappHandlers } from "./frontapp/handlers.js";
import { tools as pipedriveTools } from "./pipedrive/tools.js";
import { createHandlers as createPipedriveHandlers } from "./pipedrive/handlers.js";
import { tools as dealfrontTools } from "./dealfront/tools.js";
import { createHandlers as createDealfrontHandlers } from "./dealfront/handlers.js";
import { tools as gaTools } from "./google-analytics/tools.js";
import { createHandlers as createGAHandlers } from "./google-analytics/handlers.js";
import { tools as customerioTools } from "./customerio/tools.js";
import { createHandlers as createCustomerioHandlers } from "./customerio/handlers.js";
import { tools as instantlyTools } from "./instantly/tools.js";
import { createHandlers as createInstantlyHandlers } from "./instantly/handlers.js";
import { tools as herokuPostgresTools } from "./heroku-postgres/tools.js";
import { createHandlers as createHerokuPostgresHandlers } from "./heroku-postgres/handlers.js";
import { tools as coadminApiTools } from "./coadmin-api/tools.js";
import { createHandlers as createCoadminApiHandlers } from "./coadmin-api/handlers.js";
import { tools as papertrailTools } from "./papertrail/tools.js";
import { createHandlers as createPapertrailHandlers } from "./papertrail/handlers.js";
import { tools as githubTools } from "./github/tools.js";
import { createHandlers as createGithubHandlers } from "./github/handlers.js";
import { GoogleAuth } from "google-auth-library";

export type ModuleScope =
  | "frontapp"
  | "pipedrive"
  | "dealfront"
  | "google-analytics"
  | "customerio"
  | "instantly"
  | "heroku-postgres"
  | "coadmin-api"
  | "papertrail"
  | "github";

export interface CotributeMCPServerOptions {
  scope: ModuleScope;
  frontappToken: string;
  pipedriveToken?: string;
  pipedriveDomain?: string;
  dealfrontToken?: string;
  dealfrontIpEnrichKey?: string;
  gaCredentials?: string;
  customerioApiKey?: string;
  customerioRegion?: string;
  instantlyApiKey?: string;
  prodDbPool?: Pool | null;
  uatDbPool?: Pool | null;
  coadminApiBaseUrl?: string;
  coadminApiCreds?: { apiKey: string; apiSecret: string; clientId: string };
  papertrailToken?: string;
  githubToken?: string;
}

export class CotributeMCPServer {
  private server: Server;
  private frontappAxios: AxiosInstance | null;
  private pipedriveAxios: AxiosInstance | null;
  private dealfrontAxios: AxiosInstance | null;
  private dealfrontIpEnrichAxios: AxiosInstance | null;
  private gaDataAxios: AxiosInstance | null;
  private gaAdminAxios: AxiosInstance | null;
  private customerioAxios: AxiosInstance | null;
  private instantlyAxios: AxiosInstance | null;
  private prodDbPool: Pool | null;
  private uatDbPool: Pool | null;
  private coadminAxios: AxiosInstance | null;
  private papertrailAxios: AxiosInstance | null;
  private githubAxios: AxiosInstance | null;
  private handlers: Record<string, (args: any) => Promise<any>>;

  constructor(options: CotributeMCPServerOptions) {
    const {
      scope,
      frontappToken,
      pipedriveToken,
      pipedriveDomain,
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
      githubToken,
    } = options;
    this.server = new Server(
      { name: "switchboard", version: "2.0.0" },
      { capabilities: { tools: {}, resources: {} } }
    );

    this.handlers = {};
    this.frontappAxios = null;
    this.pipedriveAxios = null;
    this.dealfrontAxios = null;
    this.dealfrontIpEnrichAxios = null;
    this.gaDataAxios = null;
    this.gaAdminAxios = null;
    this.customerioAxios = null;
    this.instantlyAxios = null;
    this.prodDbPool = null;
    this.uatDbPool = null;
    this.coadminAxios = null;
    this.papertrailAxios = null;
    this.githubAxios = null;

    // Front.app module
    if (scope === "frontapp") {
      this.frontappAxios = axios.create({
        baseURL: "https://api2.frontapp.com",
        timeout: 15000,
        headers: {
          Authorization: `Bearer ${frontappToken}`,
          "Content-Type": "application/json",
        },
      });
      Object.assign(this.handlers, createFrontappHandlers(this.frontappAxios));
    }

    // Pipedrive module
    if (scope === "pipedrive" && pipedriveToken && pipedriveDomain) {
      this.pipedriveAxios = axios.create({
        baseURL: `https://${pipedriveDomain}.pipedrive.com/api/v1`,
        timeout: 15000,
        headers: {
          "x-api-token": pipedriveToken,
          "Content-Type": "application/json",
        },
      });
      Object.assign(
        this.handlers,
        createPipedriveHandlers(this.pipedriveAxios)
      );
    }

    // Dealfront module
    if (scope === "dealfront" && dealfrontToken) {
      this.dealfrontAxios = axios.create({
        baseURL: "https://api.leadfeeder.com",
        timeout: 15000,
        headers: {
          Authorization: `Token token=${dealfrontToken}`,
          Accept: "application/json",
        },
      });

      if (dealfrontIpEnrichKey) {
        this.dealfrontIpEnrichAxios = axios.create({
          baseURL: "https://api.lf-discover.com",
          timeout: 15000,
          headers: {
            "X-API-KEY": dealfrontIpEnrichKey,
            Accept: "application/json",
          },
        });
      }

      Object.assign(
        this.handlers,
        createDealfrontHandlers(
          this.dealfrontAxios,
          this.dealfrontIpEnrichAxios
        )
      );
    }

    // Google Analytics module
    if (scope === "google-analytics" && gaCredentials) {
      const credentials = JSON.parse(
        Buffer.from(gaCredentials, "base64").toString("utf-8")
      );
      const auth = new GoogleAuth({
        credentials,
        scopes: [
          "https://www.googleapis.com/auth/analytics.readonly",
          "https://www.googleapis.com/auth/analytics.edit",
        ],
      });

      const addAuthInterceptor = (instance: AxiosInstance) => {
        instance.interceptors.request.use(async (config) => {
          const client = await auth.getClient();
          const token = await client.getAccessToken();
          config.headers.Authorization = `Bearer ${token.token}`;
          return config;
        });
        return instance;
      };

      this.gaDataAxios = addAuthInterceptor(
        axios.create({
          baseURL: "https://analyticsdata.googleapis.com",
          timeout: 15000,
          headers: { "Content-Type": "application/json" },
        })
      );

      this.gaAdminAxios = addAuthInterceptor(
        axios.create({
          baseURL: "https://analyticsadmin.googleapis.com",
          timeout: 15000,
          headers: { "Content-Type": "application/json" },
        })
      );

      Object.assign(
        this.handlers,
        createGAHandlers(this.gaDataAxios, this.gaAdminAxios)
      );
    }

    // Customer.io module
    if (scope === "customerio" && customerioApiKey) {
      const region = customerioRegion === "eu" ? "api-eu" : "api";
      this.customerioAxios = axios.create({
        baseURL: `https://${region}.customer.io/v1`,
        timeout: 15000,
        headers: {
          Authorization: `Bearer ${customerioApiKey}`,
          "Content-Type": "application/json",
        },
      });
      Object.assign(
        this.handlers,
        createCustomerioHandlers(this.customerioAxios)
      );
    }

    // Instantly.ai module
    if (scope === "instantly" && instantlyApiKey) {
      this.instantlyAxios = axios.create({
        baseURL: "https://api.instantly.ai/api/v2",
        timeout: 15000,
        headers: {
          Authorization: `Bearer ${instantlyApiKey}`,
          "Content-Type": "application/json",
        },
      });
      Object.assign(
        this.handlers,
        createInstantlyHandlers(this.instantlyAxios)
      );
    }

    // Heroku Postgres module (CX support, per-individual)
    if (scope === "heroku-postgres") {
      if (prodDbPool) this.prodDbPool = prodDbPool;
      if (uatDbPool) this.uatDbPool = uatDbPool;
      if (this.prodDbPool || this.uatDbPool) {
        Object.assign(
          this.handlers,
          createHerokuPostgresHandlers(this.prodDbPool, this.uatDbPool)
        );
      }
    }

    // coadmin-api module (CX support, per-individual)
    if (scope === "coadmin-api" && coadminApiBaseUrl && coadminApiCreds) {
      this.coadminAxios = axios.create({
        baseURL: coadminApiBaseUrl,
        timeout: 15000,
        headers: {
          Accept: "application/json",
          "X-Cotribute-Api-Key": coadminApiCreds.apiKey,
          "X-Cotribute-Api-Secret": coadminApiCreds.apiSecret,
          "X-Cotribute-Client-Id": coadminApiCreds.clientId,
        },
      });
      Object.assign(this.handlers, createCoadminApiHandlers(this.coadminAxios));
    }

    // Papertrail module (CX support, per-individual)
    if (scope === "papertrail" && papertrailToken) {
      this.papertrailAxios = axios.create({
        baseURL: "https://papertrailapp.com",
        timeout: 15000,
        headers: { "X-Papertrail-Token": papertrailToken },
      });
      Object.assign(
        this.handlers,
        createPapertrailHandlers(this.papertrailAxios)
      );
    }

    // GitHub module (CX support, per-individual)
    if (scope === "github" && githubToken) {
      this.githubAxios = axios.create({
        baseURL: "https://api.github.com",
        timeout: 15000,
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      Object.assign(this.handlers, createGithubHandlers(this.githubAxios));
    }

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers(): void {
    const exposedTools = [
      ...(this.frontappAxios ? frontappTools : []),
      ...(this.pipedriveAxios ? pipedriveTools : []),
      ...(this.dealfrontAxios ? dealfrontTools : []),
      ...(this.gaDataAxios ? gaTools : []),
      ...(this.customerioAxios ? customerioTools : []),
      ...(this.instantlyAxios ? instantlyTools : []),
      ...(this.prodDbPool || this.uatDbPool ? herokuPostgresTools : []),
      ...(this.coadminAxios ? coadminApiTools : []),
      ...(this.papertrailAxios ? papertrailTools : []),
      ...(this.githubAxios ? githubTools : []),
    ];

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: exposedTools,
    }));

    // Front.app resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: "frontapp://conversations/recent",
          name: "Recent Conversations",
          description: "Most recently updated conversations",
          mimeType: "application/json",
        },
        {
          uri: "frontapp://teammates",
          name: "Teammates",
          description: "List of all teammates",
          mimeType: "application/json",
        },
        {
          uri: "frontapp://inboxes",
          name: "Inboxes",
          description: "List of all inboxes",
          mimeType: "application/json",
        },
        {
          uri: "frontapp://tags",
          name: "Tags",
          description: "List of all tags",
          mimeType: "application/json",
        },
      ],
    }));

    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        const uri = request.params.uri.toString();
        const resourceMap: Record<string, string> = {
          "frontapp://conversations/recent": "/conversations?limit=20",
          "frontapp://teammates": "/teammates",
          "frontapp://inboxes": "/inboxes",
          "frontapp://tags": "/tags",
        };

        const endpoint = resourceMap[uri];
        if (!endpoint) throw new Error(`Unknown resource: ${uri}`);

        if (!this.frontappAxios) {
          throw new Error(
            "Frontapp resources are only available on the frontapp scope"
          );
        }

        const response = await this.frontappAxios.get(endpoint.split("?")[0], {
          params: endpoint.includes("?") ? { limit: 20 } : undefined,
        });

        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }
    );

    // Unified tool call handler
    const handlers = this.handlers;
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const typedArgs = args as any;

      try {
        const handler = handlers[name];
        if (!handler) throw new Error(`Unknown tool: ${name}`);

        const result = await handler(typedArgs);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        // Surface HTTP status, method + path, and response body so the caller
        // can tell e.g. 401 vs 403 vs 404 — which the bare error.message can't.
        const status = error.response?.status;
        const method = error.config?.method?.toUpperCase();
        const url = error.config?.url;
        const responseBody = error.response?.data;
        const bodyMessage =
          (typeof responseBody === "string" ? responseBody : null) ||
          responseBody?.message ||
          responseBody?.error ||
          (responseBody && JSON.stringify(responseBody).slice(0, 400));
        const parts: string[] = [];
        if (status) parts.push(`HTTP ${status}`);
        if (method && url) parts.push(`${method} ${url}`);
        parts.push(bodyMessage || error.message);
        return {
          content: [{ type: "text", text: `Error: ${parts.join(" — ")}` }],
          isError: true,
        };
      }
    });
  }

  getServer(): Server {
    return this.server;
  }
}
