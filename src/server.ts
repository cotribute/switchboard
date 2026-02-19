import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";

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
import { GoogleAuth } from "google-auth-library";

export type ModuleScope =
  | "all"
  | "frontapp"
  | "pipedrive"
  | "dealfront"
  | "frontapp-lite"
  | "pipedrive-lite"
  | "dealfront-lite"
  | "google-analytics"
  | "google-analytics-lite"
  | "customerio"
  | "customerio-lite";

// Read-only tool whitelists for lite scopes (saves ~80% of context tokens)
const FRONTAPP_LITE_TOOLS = new Set([
  "search_conversations",
  "list_conversations",
  "get_conversation",
  "list_conversation_messages",
  "get_message",
  "list_contacts",
  "get_contact",
  "list_contact_conversations",
  "list_teammates",
  "list_tags",
  "list_inboxes",
  "list_conversation_comments",
  "get_analytics",
  "list_accounts",
  "get_account",
]);

const PIPEDRIVE_LITE_TOOLS = new Set([
  "list_deals",
  "get_deal",
  "search_deals",
  "get_deal_activities",
  "get_deal_products",
  "list_persons",
  "get_person",
  "search_persons",
  "get_person_deals",
  "list_organizations",
  "get_organization",
  "search_organizations",
  "get_organization_deals",
  "get_organization_persons",
  "list_activities",
  "list_notes",
  "get_note",
  "list_pipelines",
  "list_stages",
  "search_leads",
  "get_lead",
  "list_deal_fields",
  "list_person_fields",
  "list_organization_fields",
]);

const DEALFRONT_LITE_TOOLS = new Set([
  "dealfront_list_accounts",
  "dealfront_get_account",
  "dealfront_list_leads",
  "dealfront_get_lead",
  "dealfront_list_lead_visits",
  "dealfront_list_visits",
  "dealfront_list_custom_feeds",
  "dealfront_list_custom_feed_leads",
  "dealfront_get_export_status",
  "dealfront_enrich_ip",
]);

const GA_LITE_TOOLS = new Set([
  "ga_get_account_summaries",
  "ga_run_report",
  "ga_get_metadata",
]);

const CUSTOMERIO_LITE_TOOLS = new Set([
  "cio_search_customers",
  "cio_get_customer_attributes",
  "cio_get_customer_segments",
  "cio_list_segments",
  "cio_get_segment",
  "cio_get_segment_membership",
  "cio_list_campaigns",
  "cio_get_campaign",
  "cio_get_campaign_metrics",
  "cio_list_newsletters",
  "cio_get_newsletter_metrics",
  "cio_list_activities",
]);

export class CotributeMCPServer {
  private server: Server;
  private frontappAxios: AxiosInstance | null;
  private pipedriveAxios: AxiosInstance | null;
  private dealfrontAxios: AxiosInstance | null;
  private dealfrontIpEnrichAxios: AxiosInstance | null;
  private gaDataAxios: AxiosInstance | null;
  private gaAdminAxios: AxiosInstance | null;
  private customerioAxios: AxiosInstance | null;
  private handlers: Record<string, (args: any) => Promise<any>>;
  private scope: ModuleScope;

  constructor(
    frontappToken: string,
    pipedriveToken?: string,
    pipedriveDomain?: string,
    scope: ModuleScope = "all",
    dealfrontToken?: string,
    dealfrontIpEnrichKey?: string,
    gaCredentials?: string,
    customerioApiKey?: string,
    customerioRegion?: string
  ) {
    this.scope = scope;
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

    const includeFrontapp =
      scope === "all" || scope === "frontapp" || scope === "frontapp-lite";
    const includePipedrive =
      scope === "all" || scope === "pipedrive" || scope === "pipedrive-lite";
    const includeDealfront =
      scope === "all" || scope === "dealfront" || scope === "dealfront-lite";
    const includeGA =
      scope === "all" ||
      scope === "google-analytics" ||
      scope === "google-analytics-lite";
    const includeCustomerio =
      scope === "all" || scope === "customerio" || scope === "customerio-lite";

    // Front.app module
    if (includeFrontapp) {
      this.frontappAxios = axios.create({
        baseURL: "https://api2.frontapp.com",
        headers: {
          Authorization: `Bearer ${frontappToken}`,
          "Content-Type": "application/json",
        },
      });
      Object.assign(this.handlers, createFrontappHandlers(this.frontappAxios));
    }

    // Pipedrive module
    if (includePipedrive && pipedriveToken && pipedriveDomain) {
      this.pipedriveAxios = axios.create({
        baseURL: `https://${pipedriveDomain}.pipedrive.com/api/v1`,
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
    if (includeDealfront && dealfrontToken) {
      this.dealfrontAxios = axios.create({
        baseURL: "https://api.leadfeeder.com",
        headers: {
          Authorization: `Token token=${dealfrontToken}`,
          Accept: "application/json",
        },
      });

      if (dealfrontIpEnrichKey) {
        this.dealfrontIpEnrichAxios = axios.create({
          baseURL: "https://api.lf-discover.com",
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
    if (includeGA && gaCredentials) {
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
          headers: { "Content-Type": "application/json" },
        })
      );

      this.gaAdminAxios = addAuthInterceptor(
        axios.create({
          baseURL: "https://analyticsadmin.googleapis.com",
          headers: { "Content-Type": "application/json" },
        })
      );

      Object.assign(
        this.handlers,
        createGAHandlers(this.gaDataAxios, this.gaAdminAxios)
      );
    }

    // Customer.io module
    if (includeCustomerio && customerioApiKey) {
      const region = customerioRegion === "eu" ? "api-eu" : "api";
      this.customerioAxios = axios.create({
        baseURL: `https://${region}.customer.io/v1`,
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
    // Include tool definitions based on scope, with lite filtering
    const liteFilter =
      this.scope === "frontapp-lite"
        ? FRONTAPP_LITE_TOOLS
        : this.scope === "pipedrive-lite"
          ? PIPEDRIVE_LITE_TOOLS
          : this.scope === "dealfront-lite"
            ? DEALFRONT_LITE_TOOLS
            : this.scope === "google-analytics-lite"
              ? GA_LITE_TOOLS
              : this.scope === "customerio-lite"
                ? CUSTOMERIO_LITE_TOOLS
                : null;

    const allTools = [
      ...(this.frontappAxios ? frontappTools : []),
      ...(this.pipedriveAxios ? pipedriveTools : []),
      ...(this.dealfrontAxios ? dealfrontTools : []),
      ...(this.gaDataAxios ? gaTools : []),
      ...(this.customerioAxios ? customerioTools : []),
    ];

    const exposedTools = liteFilter
      ? allTools.filter((t) => liteFilter.has(t.name))
      : allTools;

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
        const errorMessage =
          error.response?.data?.message ||
          error.response?.data?.error ||
          error.message;
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    });
  }

  getServer(): Server {
    return this.server;
  }
}
