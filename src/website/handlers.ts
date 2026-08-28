import type { Pool } from "pg";

import {
  buildChatConversations,
  buildConversionInsights,
  buildDashboardMetrics,
  buildLeadJourneys,
  buildLeadSummary,
  buildPageEngagement,
  buildTrafficTrend,
  chatVisitors,
  firstTouchPerVisitor,
  groupLeadRowsIntoPeople,
  leadChannelResolver,
  RANGE_DAYS,
  type Range,
} from "./analytics.js";
import {
  ATTR_CHANNELS,
  ATTR_CONVERSIONS,
  ATTR_DIRECT_DOMAINS,
  ATTR_TOUCHES_RESOLVED,
  ATTR_UNRECOGNIZED_SOURCES,
  ATTR_VISITOR_ATTRIBUTION,
  BREAKDOWN_DIMENSIONS,
  BREAKDOWN_DIMENSION_NAMES,
  buildBreakdownSql,
  CHAT_MESSAGES_FOR_VISITORS,
  CHAT_MESSAGES_FULL_IN_WINDOW,
  CHAT_MESSAGES_IN_WINDOW,
  CHAT_SESSIONS_FOR_VISITORS,
  CHAT_SESSIONS_IN_WINDOW,
  EVENTS_FOR_VISITORS,
  EVENTS_FRESHNESS,
  EVENTS_IN_WINDOW,
  LEADS_FOR_VISITORS,
  LEADS_IN_WINDOW,
  LEADS_WITH_HISTORY_IN_WINDOW,
  PREV_CHAT_MESSAGES_IN_WINDOW,
  PREV_CHAT_SESSIONS_IN_WINDOW,
  PREV_EVENTS_IN_WINDOW,
  PREV_LEADS_IN_WINDOW,
  RECENT_LEADS,
} from "./analytics-sql.js";
import {
  buildAllTouchPerformance,
  buildChannelPerformance,
} from "./attr-report.js";

/**
 * Hard ceilings. `analytics_events` is the only table that grows without bound
 * (~21k rows at time of writing, but a traffic spike is exactly when someone
 * asks for 90 days), so raw event reads are capped and the shortfall is
 * reported rather than silently truncating a total.
 */
const MAX_EVENT_ROWS = 200_000;
/** Pretty-printed payload budget — `server.ts` sends JSON.stringify(result, null, 2). */
const MAX_RESPONSE_BYTES = 400_000;

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function resolveRange(value: unknown): Range {
  const raw = (value ?? "30d") as string;
  if (raw !== "7d" && raw !== "30d" && raw !== "90d") {
    throw new Error(`Invalid range: ${raw}. Must be "7d", "30d" or "90d".`);
  }
  return raw;
}

/**
 * `pg` returns timestamptz as Date objects, but every vendored helper compares
 * timestamps as ISO strings (`localeCompare` for ordering, `new Date(...)` for
 * arithmetic). Normalizing once at the boundary keeps those helpers byte-for-byte
 * identical to webmaster's.
 */
function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Normalizes the timestamp columns named in `fields` on every row, in place. */
function normalizeTimestamps<T>(rows: T[], ...fields: string[]): T[] {
  for (const row of rows as Array<Record<string, unknown>>) {
    for (const f of fields) {
      if (f in row) row[f] = iso(row[f]);
    }
  }
  return rows;
}

/**
 * Halves the largest list until the pretty-printed payload fits the budget —
 * the same shrink loop `db_list_customer_users` uses, and for the same reason:
 * a response the transport drops is worse than a short one that says so.
 */
function shrinkToFit<T>(
  items: T[],
  build: (kept: T[], truncated: boolean) => any
): any {
  let kept = items;
  let truncated = false;
  let result = build(kept, truncated);
  while (
    kept.length > 1 &&
    JSON.stringify(result, null, 2).length > MAX_RESPONSE_BYTES
  ) {
    kept = kept.slice(0, Math.floor(kept.length / 2));
    truncated = true;
    result = build(kept, truncated);
  }
  return result;
}

/**
 * Same budget, for builders that take a row limit rather than a list: halve the
 * limit until the payload fits.
 */
function shrinkLimitToFit(
  limit: number,
  build: (limit: number, truncated: boolean) => any
): any {
  let kept = limit;
  let truncated = false;
  let result = build(kept, truncated);
  while (
    kept > 1 &&
    JSON.stringify(result, null, 2).length > MAX_RESPONSE_BYTES
  ) {
    kept = Math.floor(kept / 2);
    truncated = true;
    result = build(kept, truncated);
  }
  return result;
}

export function createHandlers(
  pool: Pool | null
): Record<string, (args: any) => Promise<any>> {
  function db(): Pool {
    if (!pool) {
      throw new Error(
        "No website database pool configured (WEBSITE_DB_URL is unset)."
      );
    }
    return pool;
  }

  async function fetchVisitorHistory(visitorIds: string[]) {
    if (visitorIds.length === 0) {
      return {
        events: [] as any[],
        sessions: [] as any[],
        messages: [] as any[],
      };
    }
    const [eventsRes, sessionsRes, messagesRes] = await Promise.all([
      db().query(EVENTS_FOR_VISITORS, [visitorIds, MAX_EVENT_ROWS]),
      db().query(CHAT_SESSIONS_FOR_VISITORS, [visitorIds]),
      db().query(CHAT_MESSAGES_FOR_VISITORS, [visitorIds]),
    ]);
    return {
      events: normalizeTimestamps(eventsRes.rows, "created_at"),
      sessions: normalizeTimestamps(sessionsRes.rows, "started_at"),
      messages: normalizeTimestamps(messagesRes.rows, "created_at"),
    };
  }

  return {
    web_dashboard_metrics: async (args) => {
      const range = resolveRange(args?.range);
      const days = RANGE_DAYS[range];

      const [
        eventsRes,
        prevEventsRes,
        sessionsRes,
        prevSessionsRes,
        messagesRes,
        prevMessagesRes,
        leadsRes,
        prevLeadsRes,
        recentLeadsRes,
        freshnessRes,
      ] = await Promise.all([
        db().query(EVENTS_IN_WINDOW, [days, MAX_EVENT_ROWS]),
        db().query(PREV_EVENTS_IN_WINDOW, [days, MAX_EVENT_ROWS]),
        db().query(CHAT_SESSIONS_IN_WINDOW, [days]),
        db().query(PREV_CHAT_SESSIONS_IN_WINDOW, [days]),
        db().query(CHAT_MESSAGES_IN_WINDOW, [days]),
        db().query(PREV_CHAT_MESSAGES_IN_WINDOW, [days]),
        db().query(LEADS_IN_WINDOW, [days]),
        db().query(PREV_LEADS_IN_WINDOW, [days]),
        db().query(RECENT_LEADS, [25]),
        db().query(EVENTS_FRESHNESS),
      ]);

      const freshness = freshnessRes.rows[0] ?? {};

      return buildDashboardMetrics({
        range,
        events: normalizeTimestamps(eventsRes.rows, "created_at"),
        prevEvents: prevEventsRes.rows,
        chatSessions: normalizeTimestamps(sessionsRes.rows, "started_at"),
        prevChatSessions: normalizeTimestamps(
          prevSessionsRes.rows,
          "started_at"
        ),
        messages: normalizeTimestamps(messagesRes.rows, "created_at"),
        prevMessages: normalizeTimestamps(prevMessagesRes.rows, "created_at"),
        leads: normalizeTimestamps(leadsRes.rows, "created_at"),
        prevLeads: prevLeadsRes.rows,
        recentLeads: normalizeTimestamps(recentLeadsRes.rows, "created_at"),
        latestEventAt: iso(freshness.latest_event_at),
        totalEventsAllTime: Number(freshness.total_events_all_time ?? 0),
        truncated: eventsRes.rows.length >= MAX_EVENT_ROWS,
      });
    },

    web_traffic_trend: async (args) => {
      const range = resolveRange(args?.range);
      const days = RANGE_DAYS[range];

      const [eventsRes, leadsRes] = await Promise.all([
        db().query(EVENTS_IN_WINDOW, [days, MAX_EVENT_ROWS]),
        db().query(LEADS_IN_WINDOW, [days]),
      ]);

      return buildTrafficTrend({
        range,
        events: normalizeTimestamps(eventsRes.rows, "created_at"),
        leads: normalizeTimestamps(leadsRes.rows, "created_at"),
        truncated: eventsRes.rows.length >= MAX_EVENT_ROWS,
      });
    },

    web_page_engagement: async (args) => {
      const range = resolveRange(args?.range);
      const days = RANGE_DAYS[range];
      const limit = clampInt(args?.limit, 50, 1, 200);

      const [eventsRes, leadsRes, messagesRes] = await Promise.all([
        db().query(EVENTS_IN_WINDOW, [days, MAX_EVENT_ROWS]),
        db().query(LEADS_WITH_HISTORY_IN_WINDOW, [days, 5000]),
        db().query(CHAT_MESSAGES_IN_WINDOW, [days]),
      ]);

      const events = normalizeTimestamps(eventsRes.rows, "created_at");
      const leads = normalizeTimestamps(leadsRes.rows, "created_at");
      const chatMessages = normalizeTimestamps(messagesRes.rows, "created_at");
      const truncated = eventsRes.rows.length >= MAX_EVENT_ROWS;

      return shrinkLimitToFit(limit, (kept) =>
        buildPageEngagement({
          range,
          events,
          leads,
          chatMessages,
          limit: kept,
          truncated,
        })
      );
    },

    web_channel_performance: async (args) => {
      const range = resolveRange(args?.range);
      const days = RANGE_DAYS[range];
      const mode = (args?.mode ?? "first") as string;
      if (mode !== "first" && mode !== "last" && mode !== "all") {
        return {
          ok: false,
          error: `Unknown attribution mode: ${mode}`,
          allowed: ["first", "last", "all"],
        };
      }

      const [channelsRes, unrecognizedRes, directRes] = await Promise.all([
        db().query(ATTR_CHANNELS),
        db().query(ATTR_UNRECOGNIZED_SOURCES, [days]),
        db().query(ATTR_DIRECT_DOMAINS, [days]),
      ]);

      const shared = {
        channels: channelsRes.rows,
        rawSources: unrecognizedRes.rows,
        directDomains: directRes.rows,
      };

      if (mode === "all") {
        const [touchesRes, conversionsRes] = await Promise.all([
          db().query(ATTR_TOUCHES_RESOLVED, [days]),
          db().query(ATTR_CONVERSIONS),
        ]);
        return {
          ok: true,
          range,
          ...buildAllTouchPerformance({
            ...shared,
            touches: normalizeTimestamps(touchesRes.rows, "occurred_at"),
            conversions: conversionsRes.rows,
          }),
        };
      }

      const attrRes = await db().query(ATTR_VISITOR_ATTRIBUTION, [days, mode]);
      return {
        ok: true,
        range,
        ...buildChannelPerformance({
          ...shared,
          mode,
          rows: normalizeTimestamps(attrRes.rows, "first_at", "last_at"),
        }),
      };
    },

    web_recent_leads: async (args) => {
      const limit = clampInt(args?.limit, 25, 1, 200);
      const includeTest = args?.include_test !== false;

      // Over-fetch when test rows are being filtered out, so the caller still
      // gets `limit` real prospects where they exist.
      const { rows } = await db().query(RECENT_LEADS, [
        includeTest ? limit : limit * 3,
      ]);
      normalizeTimestamps(rows, "created_at");

      // A lead's channel falls back to its visitor's first touch, so the
      // visitors' event history is needed to label these the way the dashboard
      // does — the leads themselves often carry no UTM.
      const visitorIds = [
        ...new Set(
          rows
            .map((r: any) => r.visitor_id)
            .filter((v: any): v is string => !!v)
        ),
      ] as string[];
      const historyRes =
        visitorIds.length > 0
          ? await db().query(EVENTS_FOR_VISITORS, [visitorIds, MAX_EVENT_ROWS])
          : { rows: [] as any[] };
      const channelOfLead = leadChannelResolver(
        firstTouchPerVisitor(normalizeTimestamps(historyRes.rows, "created_at"))
      );

      const summaries = rows.map((l: any) =>
        buildLeadSummary(l, channelOfLead)
      );
      const leads = includeTest
        ? summaries
        : summaries.filter((l) => !l.is_test);

      return shrinkToFit(leads.slice(0, limit), (kept, truncated) => ({
        ok: true,
        include_test: includeTest,
        total: kept.length,
        leads: kept,
        ...(truncated ? { truncated: true } : {}),
      }));
    },

    web_lead_journeys: async (args) => {
      const range = resolveRange(args?.range);
      const days = RANGE_DAYS[range];
      const limit = clampInt(args?.limit, 25, 1, 100);
      const includeEvents = args?.include_events === true;

      // `leads` holds one row per action, so pull extra rows and group them into
      // people before applying the limit.
      const [leadRowsRes, insightLeadsRes, insightEventsRes] =
        await Promise.all([
          db().query(LEADS_WITH_HISTORY_IN_WINDOW, [
            days,
            Math.min(600, limit * 6),
          ]),
          db().query(LEADS_IN_WINDOW, [days]),
          db().query(EVENTS_IN_WINDOW, [days, MAX_EVENT_ROWS]),
        ]);

      const people = groupLeadRowsIntoPeople(
        normalizeTimestamps(leadRowsRes.rows, "created_at"),
        limit
      );

      const visitorIds = [
        ...new Set(
          people
            .map((rows) => rows.find((r) => !!r.visitor_id)?.visitor_id ?? null)
            .filter((v): v is string => !!v)
        ),
      ];

      // Full history for these visitors — deliberately not clipped to the range,
      // so a research path that started earlier is still visible.
      const history = await fetchVisitorHistory(visitorIds);
      const eventsByVisitor = new Map<string, any[]>();
      for (const e of history.events) {
        const list = eventsByVisitor.get(e.visitor_id) ?? [];
        list.push(e);
        eventsByVisitor.set(e.visitor_id, list);
      }

      const insights = buildConversionInsights({
        range,
        leads: normalizeTimestamps(insightLeadsRes.rows, "created_at"),
        events: normalizeTimestamps(insightEventsRes.rows, "created_at"),
        truncated: insightEventsRes.rows.length >= MAX_EVENT_ROWS,
      });

      return shrinkToFit(people, (kept, truncated) => {
        const built = buildLeadJourneys({
          range,
          people: kept,
          eventsByVisitor,
          chatVisitors: chatVisitors(history.sessions, history.messages),
          includeEvents,
          insights,
        });
        return truncated
          ? {
              ...built,
              truncated: true,
              note: "Trimmed to fit the response budget — narrow the range or drop include_events.",
            }
          : built;
      });
    },

    web_chat_conversations: async (args) => {
      const range = resolveRange(args?.range);
      const days = RANGE_DAYS[range];
      const limit = clampInt(args?.limit, 150, 1, 300);
      const sessionId =
        typeof args?.session_id === "string" ? args.session_id : null;
      const includeTranscripts = args?.include_transcripts === true;

      const messagesRes = await db().query(CHAT_MESSAGES_FULL_IN_WINDOW, [
        days,
      ]);
      const messages = normalizeTimestamps(messagesRes.rows, "created_at");

      const visitorIds = [
        ...new Set(
          messages
            .map((m: any) => m.visitor_id)
            .filter((v: any): v is string => !!v)
        ),
      ] as string[];

      const [eventsRes, leadsRes] =
        visitorIds.length > 0
          ? await Promise.all([
              db().query(EVENTS_FOR_VISITORS, [visitorIds, MAX_EVENT_ROWS]),
              db().query(LEADS_FOR_VISITORS, [visitorIds]),
            ])
          : [{ rows: [] as any[] }, { rows: [] as any[] }];

      const events = normalizeTimestamps(eventsRes.rows, "created_at");
      const leads = normalizeTimestamps(leadsRes.rows, "created_at");

      return shrinkLimitToFit(limit, (kept, truncated) => {
        const built = buildChatConversations({
          range,
          messages,
          events,
          leads,
          limit: kept,
          includeTranscripts,
          sessionId,
        });
        return truncated ? { ...built, truncated: true } : built;
      });
    },

    web_events_breakdown: async (args) => {
      const groupBy = args?.group_by;
      if (typeof groupBy !== "string" || !(groupBy in BREAKDOWN_DIMENSIONS)) {
        return {
          ok: false,
          error: `Unknown dimension: ${groupBy}`,
          allowed: BREAKDOWN_DIMENSION_NAMES,
        };
      }

      const range = resolveRange(args?.range);
      const days = RANGE_DAYS[range];
      const limit = clampInt(args?.limit, 25, 1, 200);
      const eventType =
        typeof args?.event_type === "string" ? args.event_type : null;
      const pathPrefix =
        typeof args?.path_prefix === "string" ? args.path_prefix : null;

      const { rows } = await db().query(buildBreakdownSql(groupBy), [
        days,
        eventType,
        pathPrefix,
        limit,
      ]);

      return {
        ok: true,
        range,
        group_by: groupBy,
        filters_applied: { event_type: eventType, path_prefix: pathPrefix },
        buckets: rows.map((r: any) => ({
          bucket: r.bucket,
          events: Number(r.events),
          visitors: Number(r.visitors),
          sessions: Number(r.sessions),
        })),
      };
    },
  };
}
