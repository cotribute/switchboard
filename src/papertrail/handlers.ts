import { AxiosInstance } from "axios";

export function createHandlers(
  axiosInstance: AxiosInstance
): Record<string, (args: any) => Promise<any>> {
  return {
    papertrail_list_systems: async () => {
      const response = await axiosInstance.get("/api/v1/systems.json");
      return (response.data ?? []).map((s: any) => ({
        id: s.id,
        name: s.name,
        last_event_at: s.last_event_at,
      }));
    },

    papertrail_search: async (args) => {
      const hours = Math.min(args.hours ?? 48, 168);
      const minTime = Math.floor(Date.now() / 1000) - hours * 3600;
      const params: Record<string, any> = {
        q: args.query,
        min_time: minTime,
        limit: 50,
      };
      if (args.system_id) params.system_id = args.system_id;

      const response = await axiosInstance.get("/api/v1/events/search.json", {
        params,
      });
      return (response.data?.events ?? []).map((e: any) => ({
        received_at: e.received_at,
        source_name: e.source_name,
        program: e.program,
        message: e.message,
      }));
    },
  };
}
