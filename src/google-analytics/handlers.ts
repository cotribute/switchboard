import { AxiosInstance } from "axios";

export function createHandlers(
  dataAxios: AxiosInstance,
  adminAxios: AxiosInstance
): Record<string, (args: any) => Promise<any>> {
  return {
    // ==================== Account & Property (Admin API) ====================
    ga_get_account_summaries: async (args) => {
      const response = await adminAxios.get("/v1beta/accountSummaries", {
        params: args,
      });
      return response.data;
    },
    ga_get_property_details: async (args) => {
      const { propertyId } = args;
      const response = await adminAxios.get(`/v1beta/properties/${propertyId}`);
      return response.data;
    },
    ga_list_google_ads_links: async (args) => {
      const { propertyId, ...params } = args;
      const response = await adminAxios.get(
        `/v1beta/properties/${propertyId}/googleAdsLinks`,
        { params }
      );
      return response.data;
    },

    // ==================== Reports (Data API) ====================
    ga_run_report: async (args) => {
      const { propertyId, ...body } = args;
      const response = await dataAxios.post(
        `/v1beta/properties/${propertyId}:runReport`,
        body
      );
      return response.data;
    },
    ga_run_realtime_report: async (args) => {
      const { propertyId, ...body } = args;
      const response = await dataAxios.post(
        `/v1beta/properties/${propertyId}:runRealtimeReport`,
        body
      );
      return response.data;
    },
    ga_get_metadata: async (args) => {
      const { propertyId } = args;
      const response = await dataAxios.get(
        `/v1beta/properties/${propertyId}/metadata`
      );
      return response.data;
    },
  };
}
