import { AxiosInstance } from "axios";

// Remap page_number/page_size to the bracket syntax the Leadfeeder API expects
function toPageParams(params: Record<string, any>): Record<string, any> {
  const { page_number, page_size, ...rest } = params;
  const out: Record<string, any> = { ...rest };
  if (page_number !== undefined) out["page[number]"] = page_number;
  if (page_size !== undefined) out["page[size]"] = page_size;
  return out;
}

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
      page_number?: number;
      page_size?: number;
    }) => {
      const { account_id, ...rest } = args;
      const response = await leadfeederAxios.get(
        `/accounts/${account_id}/leads`,
        { params: toPageParams(rest) }
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
      page_number?: number;
      page_size?: number;
    }) => {
      const { account_id, lead_id, ...rest } = args;
      const response = await leadfeederAxios.get(
        `/accounts/${account_id}/leads/${lead_id}/visits`,
        { params: toPageParams(rest) }
      );
      return response.data;
    },
    dealfront_list_visits: async (args: {
      account_id: string;
      start_date?: string;
      end_date?: string;
      page_number?: number;
      page_size?: number;
    }) => {
      const { account_id, ...rest } = args;
      const response = await leadfeederAxios.get(
        `/accounts/${account_id}/visits`,
        { params: toPageParams(rest) }
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
      page_number?: number;
      page_size?: number;
    }) => {
      const { account_id, feed_id, ...rest } = args;
      const response = await leadfeederAxios.get(
        `/accounts/${account_id}/custom-feeds/${feed_id}/leads`,
        { params: toPageParams(rest) }
      );
      return response.data;
    },

    // ==================== Exports ====================
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
