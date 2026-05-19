export const tools = [
  // Conversation tools
  {
    name: "list_conversations",
    description:
      "List conversations in Front. Returns conversations in reverse chronological order (most recently updated first). Supports pagination and filtering via query parameter.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of results (max 100, default 50)",
        },
        page_token: {
          type: "string",
          description: "Pagination token from previous response",
        },
        q: {
          type: "string",
          description: 'Query string for filtering (e.g., "status:archived")',
        },
      },
    },
  },
  {
    name: "get_conversation",
    description: "Get details of a specific conversation by ID",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: {
          type: "string",
          description: "Conversation ID (e.g., cnv_abc123)",
        },
      },
      required: ["conversation_id"],
    },
  },
  {
    name: "search_conversations",
    description:
      "Search for conversations using Front search syntax. Supports complex queries with status, tags, assignees, etc.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Search query (e.g., "tag:urgent status:open")',
        },
        limit: {
          type: "number",
          description: "Number of results (max 100, default 50)",
        },
      },
      required: ["query"],
    },
  },

  // Message tools
  {
    name: "list_conversation_messages",
    description:
      "List all messages in a conversation in reverse chronological order (newest first)",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: { type: "string", description: "Conversation ID" },
        limit: {
          type: "number",
          description: "Number of results (max 100, default 50)",
        },
        page_token: { type: "string", description: "Pagination token" },
      },
      required: ["conversation_id"],
    },
  },
  {
    name: "get_message",
    description: "Get details of a specific message by ID",
    inputSchema: {
      type: "object",
      properties: {
        message_id: {
          type: "string",
          description: "Message ID (e.g., msg_abc123)",
        },
      },
      required: ["message_id"],
    },
  },

  // Contact tools
  {
    name: "list_contacts",
    description: "List contacts in Front with pagination support",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of results (max 100, default 50)",
        },
        page_token: { type: "string", description: "Pagination token" },
        sort_by: { type: "string", description: "Sort field" },
        sort_order: {
          type: "string",
          enum: ["asc", "desc"],
          description: "Sort order",
        },
      },
    },
  },
  {
    name: "get_contact",
    description: "Get details of a specific contact by ID",
    inputSchema: {
      type: "object",
      properties: {
        contact_id: {
          type: "string",
          description: "Contact ID (e.g., crd_abc123)",
        },
      },
      required: ["contact_id"],
    },
  },
  {
    name: "list_contact_conversations",
    description: "List all conversations for a contact",
    inputSchema: {
      type: "object",
      properties: {
        contact_id: { type: "string", description: "Contact ID" },
        limit: { type: "number", description: "Number of results" },
        page_token: { type: "string", description: "Pagination token" },
      },
      required: ["contact_id"],
    },
  },

  // Teammate tools
  {
    name: "list_teammates",
    description: "List all teammates in the Front account",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of results" },
        page_token: { type: "string", description: "Pagination token" },
      },
    },
  },

  // Tag tools
  {
    name: "list_tags",
    description: "List all tags in the Front account",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of results" },
        page_token: { type: "string", description: "Pagination token" },
      },
    },
  },

  // Inbox tools
  {
    name: "list_inboxes",
    description: "List all inboxes accessible to the API token",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of results" },
        page_token: { type: "string", description: "Pagination token" },
      },
    },
  },

  // Comment tools
  {
    name: "list_conversation_comments",
    description: "List all comments (internal discussions) in a conversation",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: { type: "string", description: "Conversation ID" },
      },
      required: ["conversation_id"],
    },
  },

  // Analytics tools
  {
    name: "get_analytics",
    description: "Get analytics data for conversations, messages, or teammates",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "number", description: "Start timestamp (Unix time)" },
        end: { type: "number", description: "End timestamp (Unix time)" },
        metrics: {
          type: "array",
          items: { type: "string" },
          description: "Metrics to retrieve (e.g., avg_first_response_time)",
        },
        filters: { type: "object", description: "Filters to apply" },
      },
      required: ["start", "end"],
    },
  },

  // Account tools
  {
    name: "list_accounts",
    description: "List all accounts in Front",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of results (max 100, default 50)",
        },
        page_token: { type: "string", description: "Pagination token" },
      },
    },
  },
  {
    name: "get_account",
    description: "Get details of a specific account by ID",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Account ID" },
      },
      required: ["account_id"],
    },
  },
];
