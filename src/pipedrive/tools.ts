export const tools = [
  // ==================== Deals ====================
  {
    name: "list_deals",
    description:
      "List deals from Pipedrive with optional filtering by status, user, stage, pipeline, or custom filter.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of results to return. Default is 100.",
        },
        start: { type: "number", description: "Pagination start offset." },
        status: {
          type: "string",
          description: "Filter by deal status.",
          enum: ["open", "won", "lost", "deleted"],
        },
        sort: {
          type: "string",
          description: 'Field and order to sort by (e.g. "update_time DESC").',
        },
        filter_id: { type: "number", description: "ID of the filter to use." },
        user_id: { type: "number", description: "Filter deals by user ID." },
        stage_id: { type: "number", description: "Filter deals by stage ID." },
        pipeline_id: {
          type: "number",
          description: "Filter deals by pipeline ID.",
        },
      },
    },
  },
  {
    name: "get_deal",
    description: "Get a specific deal by its ID from Pipedrive.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the deal." },
      },
      required: ["id"],
    },
  },
  {
    name: "search_deals",
    description: "Search deals in Pipedrive by a search term.",
    inputSchema: {
      type: "object",
      properties: {
        term: { type: "string", description: "The search term to look for." },
        fields: {
          type: "string",
          description: "Fields to search in.",
          enum: ["custom_fields", "notes", "title"],
        },
        exact_match: {
          type: "boolean",
          description: "When true, only exact matches are returned.",
        },
        status: { type: "string", description: "Filter by deal status." },
        limit: { type: "number", description: "Number of results to return." },
        start: { type: "number", description: "Pagination start offset." },
      },
      required: ["term"],
    },
  },
  {
    name: "get_deal_activities",
    description: "Get activities associated with a specific deal.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the deal." },
        start: { type: "number", description: "Pagination start offset." },
        limit: { type: "number", description: "Number of results to return." },
        done: {
          type: "number",
          description: "Filter by done status (0 = not done, 1 = done).",
          enum: [0, 1],
        },
      },
      required: ["id"],
    },
  },
  {
    name: "get_deal_products",
    description: "Get products attached to a specific deal.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the deal." },
        start: { type: "number", description: "Pagination start offset." },
        limit: { type: "number", description: "Number of results to return." },
      },
      required: ["id"],
    },
  },

  // ==================== Persons ====================
  {
    name: "list_persons",
    description: "List persons from Pipedrive with optional filtering.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of results to return." },
        start: { type: "number", description: "Pagination start offset." },
        sort: { type: "string", description: "Field and order to sort by." },
        filter_id: { type: "number", description: "ID of the filter to use." },
        user_id: { type: "number", description: "Filter by user ID." },
      },
    },
  },
  {
    name: "get_person",
    description: "Get a specific person by ID from Pipedrive.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the person." },
      },
      required: ["id"],
    },
  },
  {
    name: "search_persons",
    description: "Search persons in Pipedrive by a search term.",
    inputSchema: {
      type: "object",
      properties: {
        term: { type: "string", description: "The search term to look for." },
        fields: {
          type: "string",
          description: "Fields to search in.",
          enum: ["custom_fields", "notes", "name", "email", "phone"],
        },
        exact_match: {
          type: "boolean",
          description: "When true, only exact matches are returned.",
        },
        limit: { type: "number", description: "Number of results to return." },
        start: { type: "number", description: "Pagination start offset." },
      },
      required: ["term"],
    },
  },
  {
    name: "get_person_deals",
    description: "Get deals associated with a specific person.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the person." },
        start: { type: "number", description: "Pagination start offset." },
        limit: { type: "number", description: "Number of results to return." },
        status: { type: "string", description: "Filter by deal status." },
      },
      required: ["id"],
    },
  },

  // ==================== Organizations ====================
  {
    name: "list_organizations",
    description: "List organizations from Pipedrive with optional filtering.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of results to return." },
        start: { type: "number", description: "Pagination start offset." },
        sort: { type: "string", description: "Field and order to sort by." },
        filter_id: { type: "number", description: "ID of the filter to use." },
        user_id: { type: "number", description: "Filter by user ID." },
      },
    },
  },
  {
    name: "get_organization",
    description: "Get a specific organization by ID from Pipedrive.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the organization." },
      },
      required: ["id"],
    },
  },
  {
    name: "search_organizations",
    description: "Search organizations in Pipedrive by a search term.",
    inputSchema: {
      type: "object",
      properties: {
        term: { type: "string", description: "The search term to look for." },
        fields: {
          type: "string",
          description: "Fields to search in.",
          enum: ["custom_fields", "notes", "name", "address"],
        },
        exact_match: {
          type: "boolean",
          description: "When true, only exact matches are returned.",
        },
        limit: { type: "number", description: "Number of results to return." },
        start: { type: "number", description: "Pagination start offset." },
      },
      required: ["term"],
    },
  },
  {
    name: "get_organization_deals",
    description: "Get deals associated with a specific organization.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the organization." },
        start: { type: "number", description: "Pagination start offset." },
        limit: { type: "number", description: "Number of results to return." },
        status: { type: "string", description: "Filter by deal status." },
      },
      required: ["id"],
    },
  },
  {
    name: "get_organization_persons",
    description: "Get persons associated with a specific organization.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the organization." },
        start: { type: "number", description: "Pagination start offset." },
        limit: { type: "number", description: "Number of results to return." },
      },
      required: ["id"],
    },
  },

  // ==================== Activities ====================
  {
    name: "list_activities",
    description: "List activities from Pipedrive with optional filtering.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "number", description: "Filter by user ID." },
        filter_id: { type: "number", description: "ID of the filter to use." },
        type: {
          type: "string",
          description:
            "Filter by activity type (e.g. call, meeting, task, deadline, email).",
        },
        start: { type: "number", description: "Pagination start offset." },
        limit: { type: "number", description: "Number of results to return." },
        done: {
          type: "number",
          description: "Filter by done status (0 = not done, 1 = done).",
          enum: [0, 1],
        },
        start_date: {
          type: "string",
          description: "Start date for filtering (YYYY-MM-DD).",
        },
        end_date: {
          type: "string",
          description: "End date for filtering (YYYY-MM-DD).",
        },
      },
    },
  },

  // ==================== Notes ====================
  {
    name: "list_notes",
    description: "List notes from Pipedrive with optional filtering.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of results to return." },
        start: { type: "number", description: "Pagination start offset." },
        sort: { type: "string", description: "Field and order to sort by." },
        user_id: { type: "number", description: "Filter by user ID." },
        deal_id: { type: "number", description: "Filter by deal ID." },
        person_id: { type: "number", description: "Filter by person ID." },
        org_id: { type: "number", description: "Filter by organization ID." },
        lead_id: { type: "string", description: "Filter by lead ID (UUID)." },
        start_date: {
          type: "string",
          description: "Start date for filtering (YYYY-MM-DD).",
        },
        end_date: {
          type: "string",
          description: "End date for filtering (YYYY-MM-DD).",
        },
        pinned_to_deal_flag: {
          type: "number",
          description: "Filter by pinned to deal (0 or 1).",
          enum: [0, 1],
        },
        pinned_to_person_flag: {
          type: "number",
          description: "Filter by pinned to person (0 or 1).",
          enum: [0, 1],
        },
        pinned_to_organization_flag: {
          type: "number",
          description: "Filter by pinned to organization (0 or 1).",
          enum: [0, 1],
        },
      },
    },
  },
  {
    name: "get_note",
    description: "Get a specific note by ID from Pipedrive.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The ID of the note." },
      },
      required: ["id"],
    },
  },

  // ==================== Pipelines ====================
  {
    name: "list_pipelines",
    description: "List all pipelines from Pipedrive.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // ==================== Stages ====================
  {
    name: "list_stages",
    description:
      "List all stages from Pipedrive, optionally filtered by pipeline.",
    inputSchema: {
      type: "object",
      properties: {
        pipeline_id: {
          type: "number",
          description: "Filter stages by pipeline ID.",
        },
      },
    },
  },

  // ==================== Leads ====================
  {
    name: "get_lead",
    description: "Get a specific lead by ID from Pipedrive.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The UUID of the lead." },
      },
      required: ["id"],
    },
  },
  {
    name: "search_leads",
    description: "Search leads in Pipedrive by a search term.",
    inputSchema: {
      type: "object",
      properties: {
        term: { type: "string", description: "The search term to look for." },
        fields: { type: "string", description: "Fields to search in." },
        exact_match: {
          type: "boolean",
          description: "When true, only exact matches are returned.",
        },
        limit: { type: "number", description: "Number of results to return." },
        start: { type: "number", description: "Pagination start offset." },
      },
      required: ["term"],
    },
  },

  // ==================== Fields ====================
  {
    name: "list_deal_fields",
    description:
      "List all deal fields (including custom fields) from Pipedrive.",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "number", description: "Pagination start offset." },
        limit: { type: "number", description: "Number of results to return." },
      },
    },
  },
  {
    name: "list_person_fields",
    description:
      "List all person fields (including custom fields) from Pipedrive.",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "number", description: "Pagination start offset." },
        limit: { type: "number", description: "Number of results to return." },
      },
    },
  },
  {
    name: "list_organization_fields",
    description:
      "List all organization fields (including custom fields) from Pipedrive.",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "number", description: "Pagination start offset." },
        limit: { type: "number", description: "Number of results to return." },
      },
    },
  },
];
