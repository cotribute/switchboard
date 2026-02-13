export const tools = [
  // ==================== Accounts ====================
  {
    name: "dealfront_list_accounts",
    description:
      "List all Dealfront (Leadfeeder) accounts accessible with the current API token.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "dealfront_get_account",
    description: "Get a specific Dealfront (Leadfeeder) account by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "The ID of the account.",
        },
      },
      required: ["account_id"],
    },
  },

  // ==================== Leads ====================
  {
    name: "dealfront_list_leads",
    description:
      "List identified company leads from Dealfront (Leadfeeder) for a given account. Returns companies that visited your website with quality scores, industry, and visit data.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "The ID of the account to list leads for.",
        },
        start_date: {
          type: "string",
          description:
            "Start date for filtering leads (YYYY-MM-DD). Defaults to 7 days ago.",
        },
        end_date: {
          type: "string",
          description:
            "End date for filtering leads (YYYY-MM-DD). Defaults to today.",
        },
        "page[number]": {
          type: "number",
          description: "Page number for pagination. Default is 1.",
        },
        "page[size]": {
          type: "number",
          description:
            "Number of results per page (max 100). Default is 10.",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "dealfront_get_lead",
    description:
      "Get a specific lead by ID from Dealfront (Leadfeeder), including full company details, quality score, visit count, and CRM linkage.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "The ID of the account.",
        },
        lead_id: {
          type: "string",
          description: "The ID of the lead.",
        },
      },
      required: ["account_id", "lead_id"],
    },
  },

  // ==================== Visits ====================
  {
    name: "dealfront_list_lead_visits",
    description:
      "Get visit details for a specific lead, including pages viewed, referral sources, visit duration, and timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "The ID of the account.",
        },
        lead_id: {
          type: "string",
          description: "The ID of the lead.",
        },
        "page[number]": {
          type: "number",
          description: "Page number for pagination.",
        },
        "page[size]": {
          type: "number",
          description: "Number of results per page (max 100).",
        },
      },
      required: ["account_id", "lead_id"],
    },
  },
  {
    name: "dealfront_list_visits",
    description:
      "List all visits across an account for a date range. Returns visit-level detail including pages, referrals, and associated leads.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "The ID of the account.",
        },
        start_date: {
          type: "string",
          description: "Start date for filtering visits (YYYY-MM-DD).",
        },
        end_date: {
          type: "string",
          description: "End date for filtering visits (YYYY-MM-DD).",
        },
        "page[number]": {
          type: "number",
          description: "Page number for pagination.",
        },
        "page[size]": {
          type: "number",
          description: "Number of results per page (max 100).",
        },
      },
      required: ["account_id"],
    },
  },

  // ==================== Custom Feeds ====================
  {
    name: "dealfront_list_custom_feeds",
    description:
      "List custom feeds (filtered lead segments) configured in the Dealfront web app for a given account.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "The ID of the account.",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "dealfront_list_custom_feed_leads",
    description:
      "Get leads from a specific custom feed. Custom feeds are pre-configured filtered segments in the Dealfront web app.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "The ID of the account.",
        },
        feed_id: {
          type: "string",
          description: "The ID of the custom feed.",
        },
        start_date: {
          type: "string",
          description: "Start date for filtering (YYYY-MM-DD).",
        },
        end_date: {
          type: "string",
          description: "End date for filtering (YYYY-MM-DD).",
        },
        "page[number]": {
          type: "number",
          description: "Page number for pagination.",
        },
        "page[size]": {
          type: "number",
          description: "Number of results per page (max 100).",
        },
      },
      required: ["account_id", "feed_id"],
    },
  },

  // ==================== Exports ====================
  {
    name: "dealfront_create_export",
    description:
      "Request an async export of lead data from Dealfront. Returns an export request ID to poll for completion.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "The ID of the account to export leads from.",
        },
        start_date: {
          type: "string",
          description: "Start date for the export (YYYY-MM-DD).",
        },
        end_date: {
          type: "string",
          description: "End date for the export (YYYY-MM-DD).",
        },
      },
      required: ["account_id", "start_date", "end_date"],
    },
  },
  {
    name: "dealfront_get_export_status",
    description:
      'Check the status of a Dealfront export request. Returns "pending", "processed", or "failed", and a download URL when ready.',
    inputSchema: {
      type: "object",
      properties: {
        export_id: {
          type: "string",
          description: "The ID of the export request.",
        },
      },
      required: ["export_id"],
    },
  },

  // ==================== IP Enrich ====================
  {
    name: "dealfront_enrich_ip",
    description:
      "Resolve an IP address to company firmographic data using the Dealfront IP Enrich API. Returns company name, industry, employee count, revenue, and location.",
    inputSchema: {
      type: "object",
      properties: {
        ip: {
          type: "string",
          description: "The IP address to resolve (e.g. 203.0.113.50).",
        },
      },
      required: ["ip"],
    },
  },
];
