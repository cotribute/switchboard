import { AxiosInstance } from "axios";

export function createHandlers(
  axiosInstance: AxiosInstance
): Record<string, (args: any) => Promise<any>> {
  return {
    // Conversation operations
    list_conversations: async (args) => {
      const response = await axiosInstance.get("/conversations", {
        params: args,
      });
      return response.data;
    },
    get_conversation: async (args) => {
      const response = await axiosInstance.get(
        `/conversations/${args.conversation_id}`
      );
      return response.data;
    },
    search_conversations: async (args) => {
      const response = await axiosInstance.get("/conversations/search", {
        params: { q: args.query, limit: args.limit },
      });
      return response.data;
    },

    // Message operations
    list_conversation_messages: async (args) => {
      const { conversation_id, ...queryParams } = args;
      const response = await axiosInstance.get(
        `/conversations/${conversation_id}/messages`,
        { params: queryParams }
      );
      return response.data;
    },
    get_message: async (args) => {
      const response = await axiosInstance.get(`/messages/${args.message_id}`);
      return response.data;
    },

    // Contact operations
    list_contacts: async (args) => {
      const response = await axiosInstance.get("/contacts", { params: args });
      return response.data;
    },
    get_contact: async (args) => {
      const response = await axiosInstance.get(`/contacts/${args.contact_id}`);
      return response.data;
    },
    list_contact_conversations: async (args) => {
      const { contact_id, ...queryParams } = args;
      const response = await axiosInstance.get(
        `/contacts/${contact_id}/conversations`,
        { params: queryParams }
      );
      return response.data;
    },

    // Teammate operations
    list_teammates: async (args) => {
      const response = await axiosInstance.get("/teammates", { params: args });
      return response.data;
    },

    // Tag operations
    list_tags: async (args) => {
      const response = await axiosInstance.get("/tags", { params: args });
      return response.data;
    },

    // Inbox operations
    list_inboxes: async (args) => {
      const response = await axiosInstance.get("/inboxes", { params: args });
      return response.data;
    },

    // Comment operations
    list_conversation_comments: async (args) => {
      const response = await axiosInstance.get(
        `/conversations/${args.conversation_id}/comments`
      );
      return response.data;
    },

    // Analytics
    get_analytics: async (args) => {
      const response = await axiosInstance.get("/analytics", { params: args });
      return response.data;
    },

    // Account operations
    list_accounts: async (args) => {
      const response = await axiosInstance.get("/accounts", { params: args });
      return response.data;
    },
    get_account: async (args) => {
      const response = await axiosInstance.get(`/accounts/${args.account_id}`);
      return response.data;
    },
  };
}
