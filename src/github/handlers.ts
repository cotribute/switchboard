import { AxiosInstance } from "axios";

export function createHandlers(
  axiosInstance: AxiosInstance
): Record<string, (args: any) => Promise<any>> {
  return {
    github_search_code: async (args) => {
      // Reject anything that could smuggle extra qualifiers into the search.
      // Internal trust boundary, but cheap to enforce.
      const repoShape = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
      const orgShape = /^[A-Za-z0-9_.-]+$/;
      const langShape = /^[A-Za-z0-9_+#.-]+$/;
      if (args.repo && !repoShape.test(args.repo)) {
        throw new Error(`Invalid repo (expected 'owner/name'): ${args.repo}`);
      }
      if (args.org && !orgShape.test(args.org)) {
        throw new Error(`Invalid org: ${args.org}`);
      }
      if (args.language && !langShape.test(args.language)) {
        throw new Error(`Invalid language: ${args.language}`);
      }

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
      }));
    },

    github_get_file: async (args) => {
      // GitHub treats '/' in the path as a directory separator and requires
      // it left literal; everything else in each segment must be encoded.
      const encodedPath = String(args.path)
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      const ref = args.ref ? `?ref=${encodeURIComponent(args.ref)}` : "";
      const response = await axiosInstance.get(
        `/repos/${args.repo}/contents/${encodedPath}${ref}`
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
