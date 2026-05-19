export const tools = [
  {
    name: "coadmin_get_application_log_counts",
    description:
      "Get counts of all log types for an onboarding application (decision-status logs, API request logs, core-banking logs, KYC evals, etc.). Use this first to see what data is available before drilling into specific log types.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "coadmin_get_decision_status_logs",
    description:
      "Get the decision-status change history for an onboarding application, with decrypted contents and the user who triggered each change. Use to trace why an application was approved, denied, or got stuck.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "coadmin_get_api_request_logs",
    description:
      "Get the decrypted external-API request/response log for an onboarding application (decisioning, core banking, fraud). Use when you need the actual request bodies and responses, not just the metadata.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "coadmin_get_flow_transition_rule_logs",
    description:
      "Get flow state-machine transition logs for an application: which transition rules fired, in what order, and what the result was. Use for diagnosing why an application went down an unexpected branch.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "coadmin_get_chex_systems_evaluations",
    description:
      "Get ChexSystems evaluation results for an onboarding application. Use when a deposit account was denied for ChexSystems-related reasons.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "coadmin_get_effectiv_evaluations",
    description:
      "Get Effectiv fraud/geo evaluation results for an onboarding application. Returns evaluation status, score, and decision details.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "coadmin_get_fis_gkyc_evaluations",
    description:
      "Get FIS GKYC (Global KYC) evaluation results for an onboarding application, with decrypted payload. Use for identity-verification or sanctions-related decision tracing.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "coadmin_get_plaid_idv_documents",
    description:
      "Get Plaid Identity Verification document records for an onboarding application. Returns IDV session status and document data. (Older Vouched IDV flows live in db_get_vouched_results.)",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "coadmin_get_docusign_logs",
    description:
      "Get DocuSign signature request and signing event logs for an onboarding application.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "coadmin_get_financial_email_logs",
    description:
      "Get outbound email log for an onboarding application, with decrypted request/response bodies. Shows template name, delivery status, and full email contents. Use when a customer reports not receiving an email or claims an email had wrong content.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "coadmin_get_flow_offer_logs",
    description:
      "Get the offer timeline for an onboarding application: what offers were shown, accepted, or rejected, and when.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "coadmin_get_document_export_configs",
    description:
      "Get the document export / bulk-export configuration that applied to this onboarding application.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "coadmin_get_repay_payments",
    description:
      "Get Repay loan-payment records for an onboarding application: status, amount, and timestamps. (Stripe PaymentIntents live in db_get_stripe_payments.)",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "coadmin_get_repay_webhook_events",
    description:
      "Get inbound Repay webhook events tied to an onboarding application. Use to diagnose loan-provider callback issues.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "coadmin_get_core_banking_request_logs",
    description:
      "Get the list of core-banking adapter request logs for an onboarding application, with decrypted request/response. Each entry's UUID can be passed to coadmin_get_core_banking_request_log for full detail.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: {
          type: "string",
          description: "onboarding_applications.id (UUID)",
        },
      },
      required: ["application_id"],
    },
  },
  {
    name: "coadmin_get_core_banking_request_log",
    description:
      "Get a single core-banking request log by its UUID, with full decrypted request/response payload. Use after coadmin_get_core_banking_request_logs identifies the entry of interest.",
    inputSchema: {
      type: "object",
      properties: {
        core_banking_request_log_uuid: {
          type: "string",
          description: "core_banking_request_logs.uuid",
        },
      },
      required: ["core_banking_request_log_uuid"],
    },
  },
];
