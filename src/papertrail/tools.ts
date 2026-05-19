export const tools = [
  {
    name: "papertrail_list_systems",
    description:
      "List all Papertrail systems (Heroku apps and other log sources). Returns each system's numeric ID and name. Call this once to discover system IDs, then pass the ID to papertrail_search to filter to a specific app (e.g. acquire-api, core-banking).",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "papertrail_search",
    description:
      "Search Papertrail logs. Accepts any search term — application UUID, user UUID, email address, or error string. Returns up to 50 matching log lines with timestamps and source app names. Covers the past 48 hours by default. Use system_id (from papertrail_list_systems) to filter to a specific Heroku app.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search term: application UUID, user UUID, email, error string, etc.",
        },
        hours: {
          type: "number",
          description: "How far back to search in hours (default 48, max 168)",
        },
        system_id: {
          type: "number",
          description:
            "Numeric Papertrail system ID to filter to a specific Heroku app. Get IDs from papertrail_list_systems. Omit to search all apps.",
        },
      },
      required: ["query"],
    },
  },
];
