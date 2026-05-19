export const tools = [
  // ==================== Campaigns ====================
  {
    name: "instantly_list_campaigns",
    description:
      "List all email outreach campaigns in Instantly.ai with optional pagination.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of results to return (default 10).",
        },
        starting_after: {
          type: "string",
          description:
            "Cursor for pagination. Use the next_starting_after value from the previous response.",
        },
        status: {
          type: "number",
          description:
            "Filter by campaign status (0 = draft, 1 = active, 2 = paused, 3 = completed).",
          enum: [0, 1, 2, 3],
        },
      },
    },
  },
  {
    name: "instantly_get_campaign",
    description:
      "Get a specific campaign by ID, including its configuration, schedule, and sequences.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The UUID of the campaign." },
      },
      required: ["id"],
    },
  },

  // ==================== Campaign Analytics ====================
  {
    name: "instantly_get_campaign_analytics",
    description:
      "Get analytics for campaigns including sent, opened, replied, and bounced counts.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: {
          type: "string",
          description:
            "Filter analytics to a specific campaign UUID. Omit for all campaigns.",
        },
        limit: { type: "number", description: "Number of results to return." },
        starting_after: {
          type: "string",
          description: "Cursor for pagination.",
        },
      },
    },
  },
  {
    name: "instantly_get_campaign_analytics_overview",
    description:
      "Get a high-level analytics overview across all campaigns (total sent, opened, replied, bounced).",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: {
          type: "string",
          description: "Filter to a specific campaign UUID.",
        },
      },
    },
  },
  {
    name: "instantly_get_campaign_analytics_daily",
    description:
      "Get daily campaign analytics broken down by date for trend analysis.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: {
          type: "string",
          description: "Filter to a specific campaign UUID.",
        },
        start_date: {
          type: "string",
          description: "Start date for the range (YYYY-MM-DD).",
        },
        end_date: {
          type: "string",
          description: "End date for the range (YYYY-MM-DD).",
        },
      },
    },
  },
  {
    name: "instantly_get_campaign_analytics_steps",
    description:
      "Get step-level analytics for a campaign showing performance at each sequence step.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: {
          type: "string",
          description: "The UUID of the campaign.",
        },
      },
      required: ["campaign_id"],
    },
  },

  // ==================== Leads ====================
  {
    name: "instantly_list_leads",
    description:
      "List leads in Instantly.ai with optional filtering by campaign, list, or status.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: {
          type: "string",
          description: "Filter leads by campaign UUID.",
        },
        list_id: {
          type: "string",
          description: "Filter leads by lead list UUID.",
        },
        email: {
          type: "string",
          description: "Filter by exact lead email address.",
        },
        limit: {
          type: "number",
          description: "Number of results to return (default 10).",
        },
        starting_after: {
          type: "string",
          description: "Cursor for pagination.",
        },
      },
    },
  },
  {
    name: "instantly_get_lead",
    description:
      "Get a specific lead by ID including all attributes, custom variables, and campaign status.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The UUID of the lead." },
      },
      required: ["id"],
    },
  },

  // ==================== Lead Lists ====================
  {
    name: "instantly_list_lead_lists",
    description: "List all lead lists in the Instantly.ai workspace.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of results to return." },
        starting_after: {
          type: "string",
          description: "Cursor for pagination.",
        },
      },
    },
  },
  {
    name: "instantly_get_lead_list",
    description: "Get a specific lead list by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The UUID of the lead list." },
      },
      required: ["id"],
    },
  },

  // ==================== Sending Accounts ====================
  {
    name: "instantly_list_accounts",
    description: "List all sending email accounts configured in Instantly.ai.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of results to return." },
        starting_after: {
          type: "string",
          description: "Cursor for pagination.",
        },
      },
    },
  },
  {
    name: "instantly_get_account",
    description: "Get a specific sending account by email address.",
    inputSchema: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description: "The email address of the sending account.",
        },
      },
      required: ["email"],
    },
  },
  {
    name: "instantly_get_account_analytics_daily",
    description:
      "Get daily analytics for sending accounts (deliverability, warmup stats).",
    inputSchema: {
      type: "object",
      properties: {
        accounts: {
          type: "array",
          description: "Array of account emails to get analytics for.",
          items: { type: "string" },
        },
        start_date: {
          type: "string",
          description: "Start date (YYYY-MM-DD).",
        },
        end_date: { type: "string", description: "End date (YYYY-MM-DD)." },
      },
    },
  },

  // ==================== Emails / Unibox ====================
  {
    name: "instantly_list_emails",
    description:
      "List emails visible in the Instantly Unibox with optional filtering.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: {
          type: "string",
          description: "Filter by campaign UUID.",
        },
        lead_email: {
          type: "string",
          description: "Filter by lead email address.",
        },
        is_unread: {
          type: "boolean",
          description: "Filter by unread status.",
        },
        email_type: {
          type: "string",
          description: "Filter by type.",
          enum: ["all", "sent", "received"],
        },
        limit: { type: "number", description: "Number of results to return." },
        starting_after: {
          type: "string",
          description: "Cursor for pagination.",
        },
      },
    },
  },
  {
    name: "instantly_get_email",
    description: "Get a specific email by ID including full body and metadata.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The UUID of the email." },
      },
      required: ["id"],
    },
  },
  {
    name: "instantly_get_unread_count",
    description: "Get the count of unread emails in the Unibox.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // ==================== Block List ====================
  {
    name: "instantly_list_blocklist_entries",
    description:
      "List all blocklist entries (blocked domains and emails) in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of results to return." },
        starting_after: {
          type: "string",
          description: "Cursor for pagination.",
        },
      },
    },
  },

  // ==================== Lead Labels ====================
  {
    name: "instantly_list_lead_labels",
    description:
      "List lead labels (interest statuses) configured in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of results to return." },
        starting_after: {
          type: "string",
          description: "Cursor for pagination.",
        },
      },
    },
  },
];
