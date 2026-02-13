import { AxiosInstance } from "axios";

/**
 * Creates Dealfront Leadfeeder API handlers.
 * Auth: `Authorization: Token token=<api_token>`
 * Base URL: https://api.leadfeeder.com
 * Docs: https://docs.leadfeeder.com/api/
 */
export function createHandlers(
  leadfeederAxios: AxiosInstance,
  ipEnrichAxios: AxiosInstance | null
): Record<string, (args: any) => Promise<any>> {
  return {
    // ==================== Accounts ====================
    dealfront_list_accounts: async () => {
      const response = await leadfeederAxios.get("/accounts");
      return response.data;
    },
    dealfront_get_account: async (args: { account_id: string }) => {
      const response = await leadfeederAxios.get(
        `/accounts/${args.account_id}`
      );
      return response.data;
    },

    // ==================== Leads ====================
    dealfront_list_leads: async (args: {
      account_id: string;
      start_date?: string;
      end_date?: string;
      "page[number]"?: number;
      "page[size]"?: number;
    }) => {
      const { account_id, ...params } = args;
      const response = await leadfeederAxios.get(
        `/accounts/${account_id}/leads`,
        { params }
      );
      return response.data;
    },
    dealfront_get_lead: async (args: {
      account_id: string;
      lead_id: string;
    }) => {
      const response = await leadfeederAxios.get(
        `/accounts/${args.account_id}/leads/${args.lead_id}`
      );
      return response.data;
    },

    // ==================== Visits ====================
    dealfront_list_lead_visits: async (args: {
      account_id: string;
      lead_id: string;
      "page[number]"?: number;
      "page[size]"?: number;
    }) => {
      const { account_id, lead_id, ...params } = args;
      const response = await leadfeederAxios.get(
        `/accounts/${account_id}/leads/${lead_id}/visits`,
        { params }
      );
      return response.data;
    },
    dealfront_list_visits: async (args: {
      account_id: string;
      start_date?: string;
      end_date?: string;
      "page[number]"?: number;
      "page[size]"?: number;
    }) => {
      const { account_id, ...params } = args;
      const response = await leadfeederAxios.get(
        `/accounts/${account_id}/visits`,
        { params }
      );
      return response.data;
    },

    // ==================== Custom Feeds ====================
    dealfront_list_custom_feeds: async (args: { account_id: string }) => {
      const response = await leadfeederAxios.get(
        `/accounts/${args.account_id}/custom-feeds`
      );
      return response.data;
    },
    dealfront_list_custom_feed_leads: async (args: {
      account_id: string;
      feed_id: string;
      start_date?: string;
      end_date?: string;
      "page[number]"?: number;
      "page[size]"?: number;
    }) => {
      const { account_id, feed_id, ...params } = args;
      const response = await leadfeederAxios.get(
        `/accounts/${account_id}/custom-feeds/${feed_id}/leads`,
        { params }
      );
      return response.data;
    },

    // ==================== Exports ====================
    dealfront_create_export: async (args: {
      account_id: string;
      start_date: string;
      end_date: string;
    }) => {
      const response = await leadfeederAxios.post("/export-requests", {
        data: {
          type: "export-requests",
          attributes: {
            account_id: args.account_id,
            start_date: args.start_date,
            end_date: args.end_date,
          },
        },
      });
      return response.data;
    },
    dealfront_get_export_status: async (args: { export_id: string }) => {
      const response = await leadfeederAxios.get(
        `/export-requests/${args.export_id}`
      );
      return response.data;
    },

    // ==================== IP Enrich ====================
    dealfront_enrich_ip: async (args: { ip: string }) => {
      if (!ipEnrichAxios) {
        throw new Error(
          "IP Enrich API is not configured. Set DEALFRONT_IP_ENRICH_API_KEY to enable."
        );
      }
      const response = await ipEnrichAxios.get("/companies", {
        params: { ip: args.ip },
      });
      return response.data;
    },
  };
}
