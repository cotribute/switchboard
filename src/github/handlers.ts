import { AxiosInstance } from "axios";

export function createHandlers(
  axiosInstance: AxiosInstance
): Record<string, (args: any) => Promise<any>> {
  return {
    github_search_code: async (args) => {
      let q = args.query;
      if (args.repo) {
        q += ` repo:${args.repo}`;
      } else {
        const org = args.org || process.env.GITHUB_DEFAULT_ORG || "cotribute";
        q += ` org:${org}`;
      }
      if (args.language) q += ` language:${args.language}`;

      const response = await axiosInstance.get("/search/code", {
        params: { q, per_page: 10 },
      });
      return (response.data?.items ?? []).map((item: any) => ({
        repository: item.repository.full_name,
        path: item.path,
        url: item.html_url,
        score: item.score,
      }));
    },

    github_get_file: async (args) => {
      const ref = args.ref ? `?ref=${encodeURIComponent(args.ref)}` : "";
      const response = await axiosInstance.get(
        `/repos/${args.repo}/contents/${args.path}${ref}`
      );
      const data = response.data;
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      return {
        path: data.path,
        sha: data.sha,
        size: data.size,
        html_url: data.html_url,
        content,
      };
    },

    github_list_recent_commits: async (args) => {
      const limit = Math.min(args.limit ?? 10, 50);
      const params: Record<string, any> = { per_page: limit };
      if (args.branch) params.sha = args.branch;

      const response = await axiosInstance.get(`/repos/${args.repo}/commits`, {
        params,
      });
      return (response.data ?? []).map((c: any) => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split("\n")[0],
        author: c.commit.author.name,
        date: c.commit.author.date,
        url: c.html_url,
      }));
    },
  };
}
