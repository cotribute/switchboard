import { BREAKDOWN_DIMENSION_NAMES } from "./analytics-sql.js";

const RANGE_PROPERTY = {
  type: "string",
  enum: ["7d", "30d", "90d"],
  description:
    "Reporting window (default: 30d). Windows open at Eastern midnight so the earliest day and today are both complete — the same bucketing the admin dashboard uses.",
} as const;

/**
 * Website analytics — read-only reads against the Supabase project shared by
 * cotribute/contribute-3.0 (the public site) and cotribute/webmaster (the admin
 * portal). Metric definitions are ports of webmaster's dashboard, so numbers
 * here should reconcile with what the portal shows for the same range.
 */
export const tools = [
  {
    name: "web_dashboard_metrics",
    description:
      "The full website scorecard for a range: visitors, sessions, chat sessions and messages, leads, lead conversion, average intent score, AI-assistant traffic, and the 'talk with us' funnel — each with the prior equal-length window and its delta. Also returns the daily trend, channel and AI-engine splits (first touch per visitor), top UTM sources / topics / roles / pages, and the 25 newest leads. Includes a freshness probe (latest_event_at, total_events_all_time) so 'no traffic this week' is distinguishable from 'this credential can't read the table'. Start here for any general 'how is the website doing' question.",
    inputSchema: {
      type: "object",
      properties: { range: RANGE_PROPERTY },
      required: [],
    },
  },
  {
    name: "web_traffic_trend",
    description:
      "Per-day visitors, sessions, events and leads across the range, bucketed on Eastern report-days. Use when the question is about shape over time rather than totals.",
    inputSchema: {
      type: "object",
      properties: { range: RANGE_PROPERTY },
      required: [],
    },
  },
  {
    name: "web_page_engagement",
    description:
      "Per-page performance: visitors, views, chat sessions started on the page, leads attributed to it (by the visitor's first-touch path), AI-assistant visitors, and conversion rate. Ranked by visitors. Use for 'which pages are working' questions.",
    inputSchema: {
      type: "object",
      properties: {
        range: RANGE_PROPERTY,
        limit: {
          type: "number",
          description: "Maximum pages to return (default: 50, max: 200)",
        },
      },
      required: [],
    },
  },
  {
    name: "web_channel_performance",
    description:
      "Marketing-channel attribution over the attr_* tables: visitors, leads and lead rate per channel, split into acquisition vs in-platform channels, plus direct/untagged traffic, unrecognized sources, and untagged referring domains. Channels carrying traffic with no attr_channels row are returned flagged (metadata_missing) rather than dropped — treat those labels as guesses.",
    inputSchema: {
      type: "object",
      properties: {
        range: RANGE_PROPERTY,
        mode: {
          type: "string",
          enum: ["first", "last", "all"],
          description:
            "Attribution model (default: first). 'first'/'last' credit each visitor's first or last touch; 'all' credits every touch, so a visitor appears in each channel they touched and a touch count is included.",
        },
      },
      required: [],
    },
  },
  {
    name: "web_recent_leads",
    description:
      "The newest leads with email, name, institution, role signal, topic interest, intent score, and the channel they arrived through. Each row carries a heuristic is_test flag with reasons (internal/disposable domains, plus-addressing, QA tokens) — the leads table mixes real prospects with QA rows and has no flag of its own.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum leads to return (default: 25, max: 200)",
        },
        include_test: {
          type: "boolean",
          description:
            "Include leads flagged as test/QA rows (default: true). Set false for a prospect-only list.",
        },
      },
      required: [],
    },
  },
  {
    name: "web_lead_journeys",
    description:
      "Per-lead conversion replay plus aggregate conversion insights. For each person (rows are grouped by visitor, falling back to email, since the leads table stores one row per action): entry page and channel, time to convert, sessions and pages before converting, the last pages before the form, dwell-ranked interests, whether they chatted first, and any Cal.com booking. The `insights` block adds averages, median time to convert, top entry pages, last pages before the form, and page lift (pages converting visitors saw disproportionately often). Visitor history is not clipped to the range, so research that started earlier is still visible.",
    inputSchema: {
      type: "object",
      properties: {
        range: RANGE_PROPERTY,
        limit: {
          type: "number",
          description: "Maximum people to return (default: 25, max: 100)",
        },
        include_events: {
          type: "boolean",
          description:
            "Include the full event-by-event replay for each lead (default: false — only a count is returned, since replays are large).",
        },
      },
      required: [],
    },
  },
  {
    name: "web_chat_conversations",
    description:
      "Site-chat analysis: conversation and message counts, average length, how many conversations produced a lead, and how many went unanswered (the assistant replied but cited no sources — a likely content gap). Also returns clustered topic buckets and the most frequent asks with examples. Conversations are reconstructed from chat_messages with a 30-minute inactivity split, because the site does not write chat_sessions rows.",
    inputSchema: {
      type: "object",
      properties: {
        range: RANGE_PROPERTY,
        limit: {
          type: "number",
          description:
            "Maximum conversations to analyze (default: 150, max: 300)",
        },
        include_transcripts: {
          type: "boolean",
          description:
            "Include the full message text of every conversation (default: false — large). Prefer session_id to pull one transcript.",
        },
        session_id: {
          type: "string",
          description:
            "Return just this one conversation, with its full transcript. Use an `id` from a previous call.",
        },
      },
      required: [],
    },
  },
  {
    name: "web_events_breakdown",
    description:
      "Ad-hoc grouping of raw analytics_events: pick one dimension and get events, unique visitors and unique sessions per bucket. Use this for questions the named metric tools do not cover — traffic by device, by UTM campaign, by referring domain, and so on.",
    inputSchema: {
      type: "object",
      properties: {
        group_by: {
          type: "string",
          enum: BREAKDOWN_DIMENSION_NAMES,
          description: `Dimension to group by. One of: ${BREAKDOWN_DIMENSION_NAMES.join(", ")}.`,
        },
        range: RANGE_PROPERTY,
        event_type: {
          type: "string",
          description:
            "Only count events of this type (e.g. page_view, form_started, lead_email_captured). Omit for all events.",
        },
        path_prefix: {
          type: "string",
          description:
            "Only count events whose path starts with this prefix (e.g. /solutions).",
        },
        limit: {
          type: "number",
          description: "Maximum buckets to return (default: 25, max: 200)",
        },
      },
      required: ["group_by"],
    },
  },
];
