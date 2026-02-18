export const tools = [
  // ==================== Account & Property ====================
  {
    name: "ga_get_account_summaries",
    description:
      "List all Google Analytics account summaries accessible by the service account. Returns account IDs, names, and their associated properties. Use this first to discover available properties.",
    inputSchema: {
      type: "object",
      properties: {
        pageSize: {
          type: "number",
          description: "Maximum number of account summaries to return.",
        },
        pageToken: {
          type: "string",
          description: "Page token from a previous response for pagination.",
        },
      },
    },
  },
  {
    name: "ga_get_property_details",
    description:
      "Get detailed information about a specific GA4 property, including display name, time zone, currency, industry category, and creation time.",
    inputSchema: {
      type: "object",
      properties: {
        propertyId: {
          type: "string",
          description:
            "The GA4 property ID (numeric string, e.g. '123456789').",
        },
      },
      required: ["propertyId"],
    },
  },

  // ==================== Reports ====================
  {
    name: "ga_run_report",
    description:
      "Run a report on a GA4 property. Common dimensions: date, city, country, deviceCategory, sessionSource, sessionMedium, pagePath, pageTitle, landingPage, browser, operatingSystem. Common metrics: sessions, totalUsers, newUsers, activeUsers, screenPageViews, averageSessionDuration, bounceRate, conversions, eventCount, engagementRate. Date ranges use YYYY-MM-DD format or relative values like 'today', 'yesterday', '7daysAgo', '30daysAgo'.",
    inputSchema: {
      type: "object",
      properties: {
        propertyId: {
          type: "string",
          description:
            "The GA4 property ID (numeric string, e.g. '123456789').",
        },
        metrics: {
          type: "array",
          description: "Metrics to retrieve (e.g. [{name: 'sessions'}]).",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "The metric name (e.g. 'sessions', 'totalUsers').",
              },
            },
          },
        },
        dateRanges: {
          type: "array",
          description:
            "Date ranges for the report (e.g. [{startDate: '7daysAgo', endDate: 'today'}]).",
          items: {
            type: "object",
            properties: {
              startDate: {
                type: "string",
                description:
                  "Start date (YYYY-MM-DD or relative like '7daysAgo').",
              },
              endDate: {
                type: "string",
                description: "End date (YYYY-MM-DD or relative like 'today').",
              },
            },
          },
        },
        dimensions: {
          type: "array",
          description:
            "Optional dimensions to group by (e.g. [{name: 'date'}]).",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "The dimension name (e.g. 'date', 'country').",
              },
            },
          },
        },
        dimensionFilter: {
          type: "object",
          description: "Optional filter on dimensions.",
        },
        metricFilter: {
          type: "object",
          description: "Optional filter on metrics.",
        },
        orderBys: {
          type: "array",
          description: "Optional ordering for the report rows.",
          items: {
            type: "object",
          },
        },
        limit: {
          type: "number",
          description: "Maximum number of rows to return. Default is 10000.",
        },
        offset: {
          type: "number",
          description: "Row offset for pagination.",
        },
        keepEmptyRows: {
          type: "boolean",
          description: "Whether to keep rows with all zero metric values.",
        },
      },
      required: ["propertyId", "metrics", "dateRanges"],
    },
  },
  {
    name: "ga_run_realtime_report",
    description:
      "Run a realtime report on a GA4 property. Shows data from the last 30 minutes. Common realtime metrics: activeUsers, screenPageViews, eventCount, conversions. Common realtime dimensions: unifiedScreenName, country, city, deviceCategory.",
    inputSchema: {
      type: "object",
      properties: {
        propertyId: {
          type: "string",
          description:
            "The GA4 property ID (numeric string, e.g. '123456789').",
        },
        metrics: {
          type: "array",
          description: "Metrics to retrieve (e.g. [{name: 'activeUsers'}]).",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "The metric name (e.g. 'activeUsers').",
              },
            },
          },
        },
        dimensions: {
          type: "array",
          description:
            "Optional dimensions to group by (e.g. [{name: 'country'}]).",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "The dimension name.",
              },
            },
          },
        },
        dimensionFilter: {
          type: "object",
          description: "Optional filter on dimensions.",
        },
        metricFilter: {
          type: "object",
          description: "Optional filter on metrics.",
        },
        limit: {
          type: "number",
          description: "Maximum number of rows to return.",
        },
      },
      required: ["propertyId", "metrics"],
    },
  },

  // ==================== Metadata ====================
  {
    name: "ga_get_metadata",
    description:
      "Get metadata about the dimensions and metrics available for a GA4 property. Useful for discovering what fields can be used in reports.",
    inputSchema: {
      type: "object",
      properties: {
        propertyId: {
          type: "string",
          description:
            "The GA4 property ID (numeric string, e.g. '123456789').",
        },
      },
      required: ["propertyId"],
    },
  },

  // ==================== Google Ads Links ====================
  {
    name: "ga_list_google_ads_links",
    description:
      "List Google Ads links for a GA4 property. Shows which Google Ads accounts are linked.",
    inputSchema: {
      type: "object",
      properties: {
        propertyId: {
          type: "string",
          description:
            "The GA4 property ID (numeric string, e.g. '123456789').",
        },
        pageSize: {
          type: "number",
          description: "Maximum number of results to return.",
        },
        pageToken: {
          type: "string",
          description: "Page token from a previous response for pagination.",
        },
      },
      required: ["propertyId"],
    },
  },
];
