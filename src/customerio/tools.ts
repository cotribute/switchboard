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
];
