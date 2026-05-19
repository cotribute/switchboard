import { AxiosInstance } from "axios";

export function createHandlers(
  axiosInstance: AxiosInstance
): Record<string, (args: any) => Promise<any>> {
  const appLog = (path: string) => async (args: any) => {
    const response = await axiosInstance.get(
      `/onboarding-applications/${encodeURIComponent(args.application_id)}/${path}`
    );
    return response.data;
  };

  return {
    coadmin_get_application_log_counts: appLog("application-log-counts"),
    coadmin_get_decision_status_logs: appLog("decision-status-logs"),
    coadmin_get_api_request_logs: appLog("api-request-logs"),
    coadmin_get_flow_transition_rule_logs: appLog("flow-transition-rule-logs"),
    coadmin_get_chex_systems_evaluations: appLog("chex-systems-evaluations"),
    coadmin_get_effectiv_evaluations: appLog("effectiv-evaluations"),
    coadmin_get_fis_gkyc_evaluations: appLog("fis-gkyc-evaluations"),
    coadmin_get_plaid_idv_documents: appLog("plaid-idv-documents"),
    coadmin_get_docusign_logs: appLog("docusign-logs"),
    coadmin_get_financial_email_logs: appLog("financial-email-logs"),
    coadmin_get_flow_offer_logs: appLog("flow-offer-logs"),
    coadmin_get_document_export_configs: appLog("document-export-configs"),
    coadmin_get_repay_payments: appLog("repay-payments"),
    coadmin_get_repay_webhook_events: appLog("repay-webhook-events"),
    coadmin_get_core_banking_request_logs: appLog("core-banking-request-logs"),

    coadmin_get_core_banking_request_log: async (args) => {
      const response = await axiosInstance.get(
        `/core-banking-request-logs/${encodeURIComponent(args.core_banking_request_log_uuid)}`
      );
      return response.data;
    },
  };
}
