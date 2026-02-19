import { AxiosInstance } from "axios";

export function createHandlers(
  axiosInstance: AxiosInstance
): Record<string, (args: any) => Promise<any>> {
  return {
    // ==================== Customers/People ====================
    cio_search_customers: async (args) => {
      const response = await axiosInstance.post("/customers", args);
      return response.data;
    },
    cio_get_customer_attributes: async (args) => {
      const response = await axiosInstance.get(
        `/customers/${args.id}/attributes`
      );
      return response.data;
    },
    cio_get_customer_segments: async (args) => {
      const response = await axiosInstance.get(
        `/customers/${args.id}/segments`
      );
      return response.data;
    },
    cio_get_customer_messages: async (args) => {
      const { id, ...params } = args;
      const response = await axiosInstance.get(`/customers/${id}/messages`, {
        params,
      });
      return response.data;
    },
    cio_get_customer_activities: async (args) => {
      const { id, ...params } = args;
      const response = await axiosInstance.get(`/customers/${id}/activities`, {
        params,
      });
      return response.data;
    },

    // ==================== Segments ====================
    cio_list_segments: async (args) => {
      const response = await axiosInstance.get("/segments", { params: args });
      return response.data;
    },
    cio_get_segment: async (args) => {
      const response = await axiosInstance.get(`/segments/${args.id}`);
      return response.data;
    },
    cio_get_segment_membership: async (args) => {
      const { id, ...params } = args;
      const response = await axiosInstance.get(`/segments/${id}/membership`, {
        params,
      });
      return response.data;
    },

    // ==================== Campaigns ====================
    cio_list_campaigns: async (args) => {
      const response = await axiosInstance.get("/campaigns", { params: args });
      return response.data;
    },
    cio_get_campaign: async (args) => {
      const response = await axiosInstance.get(`/campaigns/${args.id}`);
      return response.data;
    },
    cio_get_campaign_actions: async (args) => {
      const response = await axiosInstance.get(`/campaigns/${args.id}/actions`);
      return response.data;
    },
    cio_get_campaign_metrics: async (args) => {
      const { id, ...params } = args;
      const response = await axiosInstance.get(`/campaigns/${id}/metrics`, {
        params,
      });
      return response.data;
    },
    cio_get_campaign_journey_metrics: async (args) => {
      const { id, ...params } = args;
      const response = await axiosInstance.get(
        `/campaigns/${id}/journey_metrics`,
        { params }
      );
      return response.data;
    },

    // ==================== Messages ====================
    cio_list_messages: async (args) => {
      const response = await axiosInstance.get("/messages", { params: args });
      return response.data;
    },
    cio_get_message: async (args) => {
      const response = await axiosInstance.get(`/messages/${args.id}`);
      return response.data;
    },

    // ==================== Newsletters ====================
    cio_list_newsletters: async (args) => {
      const response = await axiosInstance.get("/newsletters", {
        params: args,
      });
      return response.data;
    },
    cio_get_newsletter: async (args) => {
      const response = await axiosInstance.get(`/newsletters/${args.id}`);
      return response.data;
    },
    cio_get_newsletter_metrics: async (args) => {
      const { id, ...params } = args;
      const response = await axiosInstance.get(`/newsletters/${id}/metrics`, {
        params,
      });
      return response.data;
    },

    // ==================== Activities ====================
    cio_list_activities: async (args) => {
      const response = await axiosInstance.get("/activities", { params: args });
      return response.data;
    },

    // ==================== Collections ====================
    cio_list_collections: async (args) => {
      const response = await axiosInstance.get("/collections", {
        params: args,
      });
      return response.data;
    },
    cio_get_collection: async (args) => {
      const response = await axiosInstance.get(`/collections/${args.id}`);
      return response.data;
    },

    // ==================== Exports ====================
    cio_list_exports: async (args) => {
      const response = await axiosInstance.get("/exports", { params: args });
      return response.data;
    },
    cio_get_export: async (args) => {
      const response = await axiosInstance.get(`/exports/${args.id}`);
      return response.data;
    },
    cio_create_customers_export: async (args) => {
      const response = await axiosInstance.post("/exports/customers", args);
      return response.data;
    },
    cio_create_deliveries_export: async (args) => {
      const response = await axiosInstance.post("/exports/deliveries", args);
      return response.data;
    },
  };
}
