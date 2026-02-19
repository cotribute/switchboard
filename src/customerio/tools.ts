export const tools = [
  // ==================== Customers/People ====================
  {
    name: "cio_search_customers",
    description:
      "Search and filter customers in Customer.io by attributes. Use filter conditions to find customers matching specific criteria.",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "object",
          description:
            "Filter object defining search criteria (e.g. {and: [{attribute: {field: 'email', operator: 'eq', value: 'test@example.com'}}]}).",
        },
        start: {
          type: "string",
          description:
            "Cursor for pagination. Use the value from the 'next' field in a previous response.",
        },
        limit: {
          type: "number",
          description: "Number of results to return per page.",
        },
      },
    },
  },
  {
    name: "cio_get_customer_attributes",
    description:
      "Get all attributes for a specific customer in Customer.io by their ID or email.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The customer ID or email address.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "cio_get_customer_segments",
    description:
      "Get the segments that a specific customer belongs to in Customer.io.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The customer ID or email address.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "cio_get_customer_messages",
    description:
      "Get messages that have been sent to a specific customer in Customer.io.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The customer ID or email address.",
        },
        start: {
          type: "string",
          description: "Cursor for pagination.",
        },
        limit: {
          type: "number",
          description: "Number of results to return per page.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "cio_get_customer_activities",
    description:
      "Get the activity log for a specific customer in Customer.io, including events, page views, and attribute changes.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The customer ID or email address.",
        },
        start: {
          type: "string",
          description: "Cursor for pagination.",
        },
        limit: {
          type: "number",
          description: "Number of results to return per page.",
        },
        type: {
          type: "string",
          description:
            "Filter by activity type (e.g. 'event', 'attribute_change', 'page', 'email_sent').",
        },
      },
      required: ["id"],
    },
  },

  // ==================== Segments ====================
  {
    name: "cio_list_segments",
    description: "List all segments in Customer.io.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "cio_get_segment",
    description: "Get details of a specific segment by ID in Customer.io.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the segment." },
      },
      required: ["id"],
    },
  },
  {
    name: "cio_get_segment_membership",
    description:
      "List the people (customers) who belong to a specific segment in Customer.io.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the segment." },
        start: {
          type: "string",
          description: "Cursor for pagination.",
        },
        limit: {
          type: "number",
          description: "Number of results to return per page.",
        },
      },
      required: ["id"],
    },
  },

  // ==================== Campaigns ====================
  {
    name: "cio_list_campaigns",
    description: "List all campaigns in Customer.io.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "cio_get_campaign",
    description:
      "Get details of a specific campaign by ID in Customer.io, including status, triggers, and settings.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the campaign." },
      },
      required: ["id"],
    },
  },
  {
    name: "cio_get_campaign_actions",
    description:
      "Get the workflow actions (steps) for a specific campaign in Customer.io.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the campaign." },
      },
      required: ["id"],
    },
  },
  {
    name: "cio_get_campaign_metrics",
    description:
      "Get performance metrics for a specific campaign in Customer.io, including sends, opens, clicks, conversions, and revenue.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the campaign." },
        period: {
          type: "string",
          description:
            "Time period for metrics (e.g. 'days', 'weeks', 'months').",
        },
        steps: {
          type: "number",
          description: "Number of time periods to include.",
        },
        type: {
          type: "string",
          description: "Metric type filter.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "cio_get_campaign_journey_metrics",
    description:
      "Get journey (flow-through) metrics for a specific campaign in Customer.io, showing how people move through each workflow step.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the campaign." },
        start: {
          type: "string",
          description: "Start date for metrics (Unix timestamp or ISO 8601).",
        },
        end: {
          type: "string",
          description: "End date for metrics (Unix timestamp or ISO 8601).",
        },
      },
      required: ["id"],
    },
  },

  // ==================== Messages ====================
  {
    name: "cio_list_messages",
    description: "List messages in Customer.io with optional filtering.",
    inputSchema: {
      type: "object",
      properties: {
        start: {
          type: "string",
          description: "Cursor for pagination.",
        },
        limit: {
          type: "number",
          description: "Number of results to return per page.",
        },
      },
    },
  },
  {
    name: "cio_get_message",
    description:
      "Get details of a specific message by ID in Customer.io, including content, status, and delivery info.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the message." },
      },
      required: ["id"],
    },
  },

  // ==================== Newsletters ====================
  {
    name: "cio_list_newsletters",
    description: "List all newsletters (broadcasts) in Customer.io.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "cio_get_newsletter",
    description:
      "Get details of a specific newsletter by ID in Customer.io, including subject, status, and recipients.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the newsletter." },
      },
      required: ["id"],
    },
  },
  {
    name: "cio_get_newsletter_metrics",
    description:
      "Get performance metrics for a specific newsletter in Customer.io, including sends, opens, clicks, and unsubscribes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the newsletter." },
        period: {
          type: "string",
          description:
            "Time period for metrics (e.g. 'days', 'weeks', 'months').",
        },
        steps: {
          type: "number",
          description: "Number of time periods to include.",
        },
        type: {
          type: "string",
          description: "Metric type filter.",
        },
      },
      required: ["id"],
    },
  },

  // ==================== Activities ====================
  {
    name: "cio_list_activities",
    description:
      "List recent activities across the Customer.io workspace, including sends, opens, clicks, and other events.",
    inputSchema: {
      type: "object",
      properties: {
        start: {
          type: "string",
          description: "Cursor for pagination.",
        },
        limit: {
          type: "number",
          description: "Number of results to return per page.",
        },
        type: {
          type: "string",
          description: "Filter by activity type.",
        },
      },
    },
  },

  // ==================== Collections ====================
  {
    name: "cio_list_collections",
    description:
      "List all data collections in Customer.io. Collections store reusable data for personalizing messages.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "cio_get_collection",
    description:
      "Get details of a specific data collection by ID in Customer.io, including its schema and data.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the collection." },
      },
      required: ["id"],
    },
  },

  // ==================== Exports ====================
  {
    name: "cio_list_exports",
    description:
      "List existing data exports in Customer.io, including their status and download links.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "cio_get_export",
    description:
      "Get the status and details of a specific export by ID in Customer.io. Use this to check if an export is complete and get the download link.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the export." },
      },
      required: ["id"],
    },
  },
  {
    name: "cio_create_customers_export",
    description:
      "Trigger a bulk export of customer data from Customer.io. The export runs asynchronously — use cio_get_export to check status.",
    inputSchema: {
      type: "object",
      properties: {
        filters: {
          type: "object",
          description:
            "Filter criteria for which customers to export (same format as cio_search_customers filter).",
        },
        fields: {
          type: "array",
          description: "List of attribute fields to include in the export.",
          items: { type: "string" },
        },
      },
    },
  },
  {
    name: "cio_create_deliveries_export",
    description:
      "Trigger a bulk export of message delivery data from Customer.io. The export runs asynchronously — use cio_get_export to check status.",
    inputSchema: {
      type: "object",
      properties: {
        newsletter_id: {
          type: "number",
          description: "Filter deliveries by newsletter ID.",
        },
        campaign_id: {
          type: "number",
          description: "Filter deliveries by campaign ID.",
        },
        start: {
          type: "number",
          description: "Start of date range (Unix timestamp).",
        },
        end: {
          type: "number",
          description: "End of date range (Unix timestamp).",
        },
      },
    },
  },
];
