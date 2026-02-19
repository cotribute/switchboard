import { AxiosInstance } from "axios";

/**
 * Creates Instantly.ai V2 API handlers.
 * Auth: `Authorization: Bearer <api_key>`
 * Base URL: https://api.instantly.ai/api/v2
 * Docs: https://developer.instantly.ai/api/v2
 */
export function createHandlers(
  axiosInstance: AxiosInstance
): Record<string, (args: any) => Promise<any>> {
  return {
    // ==================== Campaigns ====================
    instantly_list_campaigns: async (args) => {
      const response = await axiosInstance.get("/campaigns", { params: args });
      return response.data;
    },
    instantly_get_campaign: async (args: { id: string }) => {
      const response = await axiosInstance.get(`/campaigns/${args.id}`);
      return response.data;
    },
    instantly_create_campaign: async (args) => {
      const response = await axiosInstance.post("/campaigns", args);
      return response.data;
    },
    instantly_update_campaign: async (args) => {
      const { id, ...data } = args;
      const response = await axiosInstance.patch(`/campaigns/${id}`, data);
      return response.data;
    },
    instantly_delete_campaign: async (args: { id: string }) => {
      const response = await axiosInstance.delete(`/campaigns/${args.id}`);
      return response.data;
    },
    instantly_activate_campaign: async (args: { id: string }) => {
      const response = await axiosInstance.post(
        `/campaigns/${args.id}/activate`
      );
      return response.data;
    },
    instantly_pause_campaign: async (args: { id: string }) => {
      const response = await axiosInstance.post(`/campaigns/${args.id}/pause`);
      return response.data;
    },

    // ==================== Campaign Analytics ====================
    instantly_get_campaign_analytics: async (args) => {
      const response = await axiosInstance.get("/campaigns/analytics", {
        params: args,
      });
      return response.data;
    },
    instantly_get_campaign_analytics_overview: async (args) => {
      const response = await axiosInstance.get(
        "/campaigns/analytics/overview",
        { params: args }
      );
      return response.data;
    },
    instantly_get_campaign_analytics_daily: async (args) => {
      const response = await axiosInstance.get("/campaigns/analytics/daily", {
        params: args,
      });
      return response.data;
    },
    instantly_get_campaign_analytics_steps: async (args) => {
      const response = await axiosInstance.get("/campaigns/analytics/steps", {
        params: args,
      });
      return response.data;
    },

    // ==================== Leads ====================
    instantly_list_leads: async (args) => {
      // Instantly V2 uses POST for listing leads due to complex filter args
      const response = await axiosInstance.post("/leads/list", args);
      return response.data;
    },
    instantly_get_lead: async (args: { id: string }) => {
      const response = await axiosInstance.get(`/leads/${args.id}`);
      return response.data;
    },
    instantly_create_lead: async (args) => {
      const response = await axiosInstance.post("/leads", args);
      return response.data;
    },
    instantly_update_lead: async (args) => {
      const { id, ...data } = args;
      const response = await axiosInstance.patch(`/leads/${id}`, data);
      return response.data;
    },
    instantly_delete_leads: async (args) => {
      const response = await axiosInstance.delete("/leads", { data: args });
      return response.data;
    },
    instantly_move_leads: async (args) => {
      const response = await axiosInstance.post("/leads/move", args);
      return response.data;
    },

    // ==================== Lead Lists ====================
    instantly_list_lead_lists: async (args) => {
      const response = await axiosInstance.get("/lead-lists", { params: args });
      return response.data;
    },
    instantly_get_lead_list: async (args: { id: string }) => {
      const response = await axiosInstance.get(`/lead-lists/${args.id}`);
      return response.data;
    },
    instantly_create_lead_list: async (args) => {
      const response = await axiosInstance.post("/lead-lists", args);
      return response.data;
    },

    // ==================== Sending Accounts ====================
    instantly_list_accounts: async (args) => {
      const response = await axiosInstance.get("/accounts", { params: args });
      return response.data;
    },
    instantly_get_account: async (args: { email: string }) => {
      const response = await axiosInstance.get(`/accounts/${args.email}`);
      return response.data;
    },
    instantly_get_account_analytics_daily: async (args) => {
      const response = await axiosInstance.get("/accounts/analytics/daily", {
        params: args,
      });
      return response.data;
    },
    instantly_enable_warmup: async (args) => {
      const response = await axiosInstance.post(
        "/accounts/warmup/enable",
        args
      );
      return response.data;
    },
    instantly_disable_warmup: async (args) => {
      const response = await axiosInstance.post(
        "/accounts/warmup/disable",
        args
      );
      return response.data;
    },

    // ==================== Emails / Unibox ====================
    instantly_list_emails: async (args) => {
      const response = await axiosInstance.get("/emails", { params: args });
      return response.data;
    },
    instantly_get_email: async (args: { id: string }) => {
      const response = await axiosInstance.get(`/emails/${args.id}`);
      return response.data;
    },
    instantly_reply_to_email: async (args) => {
      const response = await axiosInstance.post("/emails/reply", args);
      return response.data;
    },
    instantly_get_unread_count: async () => {
      const response = await axiosInstance.get("/emails/unread/count");
      return response.data;
    },

    // ==================== Email Verification ====================
    instantly_verify_email: async (args) => {
      const response = await axiosInstance.post("/email-verification", args);
      return response.data;
    },

    // ==================== Block List ====================
    instantly_list_blocklist_entries: async (args) => {
      const response = await axiosInstance.get("/block-list-entries", {
        params: args,
      });
      return response.data;
    },
    instantly_add_blocklist_entry: async (args) => {
      const response = await axiosInstance.post("/block-list-entries", args);
      return response.data;
    },
    instantly_delete_blocklist_entry: async (args: { id: string }) => {
      const response = await axiosInstance.delete(
        `/block-list-entries/${args.id}`
      );
      return response.data;
    },

    // ==================== Lead Labels ====================
    instantly_list_lead_labels: async (args) => {
      const response = await axiosInstance.get("/lead-labels", { params: args });
      return response.data;
    },
  };
}
