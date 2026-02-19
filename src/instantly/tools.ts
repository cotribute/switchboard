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
  {
    name: "instantly_create_campaign",
    description: "Create a new email outreach campaign in Instantly.ai.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The name of the campaign." },
        campaign_schedule: {
          type: "object",
          description:
            "Schedule configuration for the campaign (timezone, days, timing).",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "instantly_update_campaign",
    description: "Update an existing campaign's settings in Instantly.ai.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The UUID of the campaign to update.",
        },
        name: { type: "string", description: "The new name of the campaign." },
        campaign_schedule: {
          type: "object",
          description: "Updated schedule configuration.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "instantly_delete_campaign",
    description: "Delete a campaign from Instantly.ai.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The UUID of the campaign to delete.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "instantly_activate_campaign",
    description: "Activate/launch a campaign to start sending emails.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The UUID of the campaign to activate.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "instantly_pause_campaign",
    description: "Pause a running campaign.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The UUID of the campaign to pause.",
        },
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
  {
    name: "instantly_create_lead",
    description:
      "Create a new lead and optionally assign it to a campaign or lead list.",
    inputSchema: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description: "The email address of the lead.",
        },
        first_name: {
          type: "string",
          description: "The first name of the lead.",
        },
        last_name: {
          type: "string",
          description: "The last name of the lead.",
        },
        company_name: {
          type: "string",
          description: "The company name of the lead.",
        },
        phone: {
          type: "string",
          description: "The phone number of the lead.",
        },
        website: { type: "string", description: "The website of the lead." },
        campaign_id: {
          type: "string",
          description: "UUID of the campaign to assign the lead to.",
        },
        list_id: {
          type: "string",
          description: "UUID of the lead list to assign the lead to.",
        },
        custom_variables: {
          type: "object",
          description:
            "Key-value pairs for custom variables (e.g. { company: 'Acme' }).",
        },
      },
      required: ["email"],
    },
  },
  {
    name: "instantly_update_lead",
    description: "Update an existing lead's attributes in Instantly.ai.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The UUID of the lead to update." },
        first_name: { type: "string", description: "Updated first name." },
        last_name: { type: "string", description: "Updated last name." },
        company_name: { type: "string", description: "Updated company name." },
        phone: { type: "string", description: "Updated phone number." },
        website: { type: "string", description: "Updated website." },
        custom_variables: {
          type: "object",
          description: "Updated custom variables.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "instantly_delete_leads",
    description:
      "Delete leads from Instantly.ai by providing a list of lead IDs or emails.",
    inputSchema: {
      type: "object",
      properties: {
        delete_list: {
          type: "array",
          description: "Array of lead emails to delete.",
          items: { type: "string" },
        },
        campaign_id: {
          type: "string",
          description:
            "Campaign UUID to scope the deletion to (only removes from this campaign).",
        },
      },
      required: ["delete_list"],
    },
  },
  {
    name: "instantly_move_leads",
    description: "Move leads to a different campaign or lead list.",
    inputSchema: {
      type: "object",
      properties: {
        lead_ids: {
          type: "array",
          description: "Array of lead UUIDs to move.",
          items: { type: "string" },
        },
        to_campaign_id: {
          type: "string",
          description: "Destination campaign UUID.",
        },
        to_list_id: {
          type: "string",
          description: "Destination lead list UUID.",
        },
        from_campaign_id: {
          type: "string",
          description: "Source campaign UUID.",
        },
      },
      required: ["lead_ids"],
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
  {
    name: "instantly_create_lead_list",
    description: "Create a new lead list.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the lead list." },
      },
      required: ["name"],
    },
  },

  // ==================== Sending Accounts ====================
  {
    name: "instantly_list_accounts",
    description:
      "List all sending email accounts configured in Instantly.ai.",
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
  {
    name: "instantly_enable_warmup",
    description: "Enable email warmup for one or more sending accounts.",
    inputSchema: {
      type: "object",
      properties: {
        accounts: {
          type: "array",
          description: "Array of account emails to enable warmup for.",
          items: { type: "string" },
        },
      },
      required: ["accounts"],
    },
  },
  {
    name: "instantly_disable_warmup",
    description: "Disable email warmup for one or more sending accounts.",
    inputSchema: {
      type: "object",
      properties: {
        accounts: {
          type: "array",
          description: "Array of account emails to disable warmup for.",
          items: { type: "string" },
        },
      },
      required: ["accounts"],
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
    name: "instantly_reply_to_email",
    description: "Reply to an email thread in the Unibox.",
    inputSchema: {
      type: "object",
      properties: {
        reply_to_uuid: {
          type: "string",
          description: "UUID of the email to reply to.",
        },
        from_email: {
          type: "string",
          description: "Sending account email to reply from.",
        },
        body: {
          type: "string",
          description: "HTML body of the reply.",
        },
      },
      required: ["reply_to_uuid", "from_email", "body"],
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

  // ==================== Email Verification ====================
  {
    name: "instantly_verify_email",
    description: "Verify a single email address for deliverability.",
    inputSchema: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description: "The email address to verify.",
        },
      },
      required: ["email"],
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
  {
    name: "instantly_add_blocklist_entry",
    description:
      "Add an email or domain to the blocklist to prevent outreach.",
    inputSchema: {
      type: "object",
      properties: {
        entry: {
          type: "string",
          description:
            "Email address or domain to block (e.g. 'spam@example.com' or 'example.com').",
        },
        entry_type: {
          type: "string",
          description: "Type of entry.",
          enum: ["email", "domain"],
        },
      },
      required: ["entry", "entry_type"],
    },
  },
  {
    name: "instantly_delete_blocklist_entry",
    description: "Remove an entry from the blocklist.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The UUID of the blocklist entry to remove.",
        },
      },
      required: ["id"],
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
