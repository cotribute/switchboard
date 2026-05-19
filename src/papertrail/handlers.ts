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
      const limit = 50;
      const minTime = Math.floor(Date.now() / 1000) - hours * 3600;
      const params: Record<string, any> = {
        q: args.query,
        min_time: minTime,
        limit,
      };
      if (args.system_id) params.system_id = args.system_id;
      if (args.max_id) params.max_id = args.max_id;

      const response = await axiosInstance.get("/api/v1/events/search.json", {
        params,
      });
      const rawEvents = response.data?.events ?? [];
      const events = rawEvents.map((e: any) => ({
        received_at: e.received_at,
        source_name: e.source_name,
        program: e.program,
        message: e.message,
      }));
      const truncated = rawEvents.length >= limit;
      // Papertrail returns events newest-first; the smallest id in the page
      // becomes max_id for the next (older) page.
      const next_max_id = truncated
        ? rawEvents[rawEvents.length - 1]?.id
        : undefined;
      return { events, truncated, next_max_id };
    },
  };
}
