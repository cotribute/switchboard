import { AxiosInstance } from "axios";

export function createHandlers(
  axiosInstance: AxiosInstance
): Record<string, (args: any) => Promise<any>> {
  return {
    // ==================== Deals ====================
    list_deals: async (args) => {
      const response = await axiosInstance.get("/deals", { params: args });
      return response.data;
    },
    get_deal: async (args) => {
      const response = await axiosInstance.get(`/deals/${args.id}`);
      return response.data;
    },
    search_deals: async (args) => {
      const response = await axiosInstance.get("/deals/search", {
        params: args,
      });
      return response.data;
    },
    get_deal_activities: async (args) => {
      const { id, ...params } = args;
      const response = await axiosInstance.get(`/deals/${id}/activities`, {
        params,
      });
      return response.data;
    },
    get_deal_products: async (args) => {
      const { id, ...params } = args;
      const response = await axiosInstance.get(`/deals/${id}/products`, {
        params,
      });
      return response.data;
    },

    // ==================== Persons ====================
    list_persons: async (args) => {
      const response = await axiosInstance.get("/persons", { params: args });
      return response.data;
    },
    get_person: async (args) => {
      const response = await axiosInstance.get(`/persons/${args.id}`);
      return response.data;
    },
    search_persons: async (args) => {
      const response = await axiosInstance.get("/persons/search", {
        params: args,
      });
      return response.data;
    },
    get_person_deals: async (args) => {
      const { id, ...params } = args;
      const response = await axiosInstance.get(`/persons/${id}/deals`, {
        params,
      });
      return response.data;
    },

    // ==================== Organizations ====================
    list_organizations: async (args) => {
      const response = await axiosInstance.get("/organizations", {
        params: args,
      });
      return response.data;
    },
    get_organization: async (args) => {
      const response = await axiosInstance.get(`/organizations/${args.id}`);
      return response.data;
    },
    search_organizations: async (args) => {
      const response = await axiosInstance.get("/organizations/search", {
        params: args,
      });
      return response.data;
    },
    get_organization_deals: async (args) => {
      const { id, ...params } = args;
      const response = await axiosInstance.get(`/organizations/${id}/deals`, {
        params,
      });
      return response.data;
    },
    get_organization_persons: async (args) => {
      const { id, ...params } = args;
      const response = await axiosInstance.get(`/organizations/${id}/persons`, {
        params,
      });
      return response.data;
    },

    // ==================== Activities ====================
    list_activities: async (args) => {
      const response = await axiosInstance.get("/activities", { params: args });
      return response.data;
    },

    // ==================== Notes ====================
    list_notes: async (args) => {
      const response = await axiosInstance.get("/notes", { params: args });
      return response.data;
    },
    get_note: async (args) => {
      const response = await axiosInstance.get(`/notes/${args.id}`);
      return response.data;
    },

    // ==================== Pipelines ====================
    list_pipelines: async (args) => {
      const response = await axiosInstance.get("/pipelines", { params: args });
      return response.data;
    },

    // ==================== Stages ====================
    list_stages: async (args) => {
      const response = await axiosInstance.get("/stages", { params: args });
      return response.data;
    },

    // ==================== Leads ====================
    get_lead: async (args) => {
      const response = await axiosInstance.get(`/leads/${args.id}`);
      return response.data;
    },
    search_leads: async (args) => {
      const response = await axiosInstance.get("/leads/search", {
        params: args,
      });
      return response.data;
    },

    // ==================== Fields ====================
    list_deal_fields: async (args) => {
      const response = await axiosInstance.get("/dealFields", { params: args });
      return response.data;
    },
    list_person_fields: async (args) => {
      const response = await axiosInstance.get("/personFields", {
        params: args,
      });
      return response.data;
    },
    list_organization_fields: async (args) => {
      const response = await axiosInstance.get("/organizationFields", {
        params: args,
      });
      return response.data;
    },
  };
}
