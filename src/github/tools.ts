export const tools = [
  {
    name: "github_search_code",
    description:
      "Search code across Cotribute's GitHub repositories. Useful for finding where an error message is thrown, how a flow slug or adapter operation is implemented, or where a config field is read. Returns file paths, repo names, and URLs. If neither repo nor org is provided, defaults to searching the cotribute org.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search term: error message, function name, slug, field name, etc.",
        },
        repo: {
          type: "string",
          description:
            "Limit to a specific repo in 'org/repo' format (e.g. 'cotribute/dreambigger'). Takes precedence over org.",
        },
        org: {
          type: "string",
          description:
            "Limit to a GitHub org (e.g. 'cotribute'). Defaults to GITHUB_DEFAULT_ORG env var or 'cotribute' when neither repo nor org is set.",
        },
        language: {
          type: "string",
          description:
            "Filter by language (e.g. 'typescript', 'ruby'). Optional.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "github_get_file",
    description:
      "Fetch the contents of a specific file from a GitHub repository. Use after github_search_code identifies the relevant file path.",
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description:
            "Repository in 'org/repo' format (e.g. 'cotribute/dreambigger')",
        },
        path: {
          type: "string",
          description:
            "File path within the repo (e.g. 'src/handlers/loanDecision.ts')",
        },
        ref: {
          type: "string",
          description:
            "Branch, tag, or commit SHA. Defaults to the repo's default branch.",
        },
      },
      required: ["repo", "path"],
    },
  },
  {
    name: "github_list_recent_commits",
    description:
      "List recent commits on a repository branch. Useful for spotting what changed recently when diagnosing a regression or unexpected behavior.",
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository in 'org/repo' format",
        },
        branch: {
          type: "string",
          description: "Branch name (defaults to the repo's default branch)",
        },
        limit: {
          type: "number",
          description: "Number of commits to return (default 10, max 50)",
        },
      },
      required: ["repo"],
    },
  },
];
