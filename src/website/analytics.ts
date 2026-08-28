/**
 * Pure metric builders for the website-analytics module.
 *
 * Every function here takes already-fetched rows and returns a plain object —
 * no DB, no I/O — so the aggregation logic can be exercised directly from
 * `scratch/*.mjs` without a database, the same split `heroku-postgres` uses for
 * its battery tools.
 *
 * The definitions are ports of cotribute/webmaster's
 * `src/lib/admin-metrics.functions.ts`. Where webmaster does something
 * non-obvious (chat sessions reconstructed from messages, first-touch-per-visitor
 * channel attribution, Eastern report-day buckets) that behavior is reproduced
 * rather than improved, so the two agree.
 */

import { classifyChannel, readUtmFields, type Channel } from "./channels.js";
import {
  chatVisitorsFrom,
  deriveChatSessions,
  resolveChatSessions,
  SESSION_GAP_MINUTES,
  type ChatMessageLike,
} from "./chat-sessions.js";
import {
  buildTopAsks,
  buildTopicBuckets,
  snippet,
  type QuestionInput,
} from "./chat-topics.js";
import { buildReportDays, toReportDayKey } from "./report-day.js";
import { isTalkWithUsPath } from "./talk-page.js";
import { classifyTestLead } from "./test-leads.js";

export type Range = "7d" | "30d" | "90d";

export const RANGE_DAYS: Record<Range, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** Longest window a visitor timeline is replayed over. */
const MAX_DWELL_SECONDS = 30 * 60;

function tally<T extends string | null | undefined>(
  rows: Array<{ value: T }>,
  limit = 5
): Array<{ key: string; count: number }> {
  const map = new Map<string, number>();
  for (const { value } of rows) {
    const k = (value ?? "").toString().trim();
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Percentage to one decimal place, matching the dashboard's rounding. */
function pct(part: number, whole: number): number {
  return whole > 0 ? round1((part / whole) * 100) : 0;
}

function avg(xs: number[]): number | null {
  return xs.length ? round1(xs.reduce((s, v) => s + v, 0) / xs.length) : null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return round1(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

// ── Dashboard metrics ────────────────────────────────────────────────────────

export type EventRow = {
  visitor_id: string | null;
  session_id: string | null;
  event_type: string | null;
  path: string | null;
  referrer: string | null;
  utm: unknown;
  created_at: string;
};

export type LeadRow = {
  id: string;
  created_at: string;
  visitor_id: string | null;
  email: string | null;
  name?: string | null;
  institution?: string | null;
  intent_score?: number | null;
  topic_interest?: string | null;
  role_signal?: string | null;
  utm?: unknown;
};

export type FirstTouch = { channel: Channel; engine: string | null };

/**
 * How a lead's channel is decided: the lead's own UTM wins, and only when that
 * says "Direct" does it inherit the visitor's first touch.
 */
export function leadChannelResolver(
  firstTouchByVisitor: Map<string, FirstTouch>
) {
  return (lead: LeadRow) => {
    const direct = classifyChannel(null, lead.utm);
    if (direct.channel !== "Direct") return direct;
    const touch = lead.visitor_id
      ? firstTouchByVisitor.get(lead.visitor_id)
      : undefined;
    if (touch) {
      return {
        channel: touch.channel,
        engine: touch.engine,
        label: touch.engine
          ? `${touch.channel} (${touch.engine})`
          : touch.channel,
      };
    }
    return direct;
  };
}

/** First classified touch per visitor, from an ascending event list. */
export function firstTouchPerVisitor(
  events: EventRow[]
): Map<string, FirstTouch> {
  const map = new Map<string, FirstTouch>();
  for (const e of events) {
    if (!e.visitor_id || map.has(e.visitor_id)) continue;
    const c = classifyChannel(e.referrer, e.utm);
    map.set(e.visitor_id, { channel: c.channel, engine: c.engine });
  }
  return map;
}

/** One lead row as the dashboard's lead list renders it, test-flag included. */
export function buildLeadSummary(
  lead: LeadRow,
  channelOfLead: ReturnType<typeof leadChannelResolver>
) {
  const c = channelOfLead(lead);
  const verdict = classifyTestLead({
    email: lead.email,
    name: lead.name,
    institution: lead.institution,
  });
  return {
    id: lead.id,
    email: lead.email,
    name: lead.name ?? null,
    institution: lead.institution ?? null,
    role_signal: lead.role_signal ?? null,
    topic_interest: lead.topic_interest ?? null,
    intent_score: lead.intent_score ?? null,
    created_at: lead.created_at,
    utm_source: readUtmFields(lead.utm).source,
    channel: c.channel,
    channel_label: c.label,
    // Heuristic QA/internal detection — see test-leads.ts.
    is_test: verdict.isTest,
    test_reasons: verdict.reasons,
  };
}

export function buildDashboardMetrics(input: {
  range: Range;
  events: EventRow[];
  prevEvents: Array<{ visitor_id: string | null }>;
  chatSessions: Array<{ visitor_id?: string | null; started_at: string }>;
  prevChatSessions: Array<{ visitor_id?: string | null; started_at: string }>;
  messages: ChatMessageLike[];
  prevMessages: ChatMessageLike[];
  leads: LeadRow[];
  prevLeads: Array<{ id: string }>;
  recentLeads: LeadRow[];
  latestEventAt: string | null;
  totalEventsAllTime: number;
  truncated: boolean;
}) {
  const { range, events, leads, messages } = input;

  // The site currently never writes chat_sessions rows, so fall back to
  // sessions derived from the messages themselves (30-min inactivity split).
  const sessions = resolveChatSessions(input.chatSessions, messages);

  const visitorSet = new Set<string>();
  const sessionSet = new Set<string>();
  const talkVisitorSet = new Set<string>();
  let talkPageViews = 0;
  let talkFormStarts = 0;
  let talkEmailCaptured = 0;

  for (const e of events) {
    if (e.visitor_id) visitorSet.add(e.visitor_id);
    if (e.session_id) sessionSet.add(e.session_id);
    if (isTalkWithUsPath(e.path)) {
      // Only real page views count as views — the same path also emits
      // form_started / lead_email_captured events.
      if (e.event_type === "page_view") {
        talkPageViews++;
        if (e.visitor_id) talkVisitorSet.add(e.visitor_id);
      } else if (e.event_type === "form_started") {
        talkFormStarts++;
      } else if (e.event_type === "lead_email_captured") {
        talkEmailCaptured++;
      }
    }
  }

  const intents = leads
    .map((l) => l.intent_score)
    .filter((v): v is number => typeof v === "number");
  const avgIntentScore = intents.length ? avg(intents) : null;

  // ── Daily trend, bucketed on Eastern report-days ──
  const days = buildReportDays(RANGE_DAYS[range]);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const trend = days.map((day) => ({
    day,
    visitors: 0,
    chat_sessions: 0,
    leads: 0,
    ai_visitors: 0,
  }));
  const visitorsPerDay = days.map(() => new Set<string>());
  const aiVisitorsPerDay = days.map(() => new Set<string>());

  for (const e of events) {
    const idx = dayIndex.get(toReportDayKey(e.created_at));
    if (idx == null || !e.visitor_id) continue;
    visitorsPerDay[idx].add(e.visitor_id);
    if (classifyChannel(e.referrer, e.utm).channel === "AI assistant") {
      aiVisitorsPerDay[idx].add(e.visitor_id);
    }
  }
  trend.forEach((t, i) => {
    t.visitors = visitorsPerDay[i].size;
    t.ai_visitors = aiVisitorsPerDay[i].size;
  });
  for (const s of sessions) {
    const idx = dayIndex.get(toReportDayKey(s.started_at));
    if (idx != null) trend[idx].chat_sessions++;
  }
  for (const l of leads) {
    const idx = dayIndex.get(toReportDayKey(l.created_at));
    if (idx != null) trend[idx].leads++;
  }

  // ── Channel attribution (first touch per visitor) ──
  const firstTouchByVisitor = firstTouchPerVisitor(events);

  const channelVisitors = new Map<Channel, Set<string>>();
  const channelLeads = new Map<Channel, number>();
  const engineVisitors = new Map<string, Set<string>>();
  const engineLeads = new Map<string, number>();

  for (const [visitorId, c] of firstTouchByVisitor) {
    let set = channelVisitors.get(c.channel);
    if (!set) channelVisitors.set(c.channel, (set = new Set()));
    set.add(visitorId);
    if (c.channel === "AI assistant" && c.engine) {
      let es = engineVisitors.get(c.engine);
      if (!es) engineVisitors.set(c.engine, (es = new Set()));
      es.add(visitorId);
    }
  }

  const channelOfLead = leadChannelResolver(firstTouchByVisitor);

  for (const l of leads) {
    const c = channelOfLead(l);
    channelLeads.set(c.channel, (channelLeads.get(c.channel) ?? 0) + 1);
    if (c.channel === "AI assistant" && c.engine) {
      engineLeads.set(c.engine, (engineLeads.get(c.engine) ?? 0) + 1);
    }
  }

  const channels = [
    ...new Set<Channel>([...channelVisitors.keys(), ...channelLeads.keys()]),
  ]
    .map((channel) => ({
      channel,
      visitors: channelVisitors.get(channel)?.size ?? 0,
      leads: channelLeads.get(channel) ?? 0,
    }))
    .sort((a, b) => b.visitors - a.visitors || b.leads - a.leads);

  const aiEngines = [
    ...new Set<string>([...engineVisitors.keys(), ...engineLeads.keys()]),
  ]
    .map((engine) => ({
      engine,
      visitors: engineVisitors.get(engine)?.size ?? 0,
      leads: engineLeads.get(engine) ?? 0,
    }))
    .sort((a, b) => b.visitors - a.visitors || b.leads - a.leads);

  const utmRows = [...events, ...leads].map((r) => ({
    value: readUtmFields((r as { utm?: unknown }).utm).source,
  }));

  const visitors = visitorSet.size;

  const prevVisitorSet = new Set<string>();
  for (const e of input.prevEvents)
    if (e.visitor_id) prevVisitorSet.add(e.visitor_id);
  const previousTotals = {
    visitors: prevVisitorSet.size,
    chat_sessions: resolveChatSessions(
      input.prevChatSessions,
      input.prevMessages
    ).length,
    leads: input.prevLeads.length,
  };

  const delta = (current: number, previous: number) => ({
    current,
    previous,
    change: current - previous,
    change_pct:
      previous > 0 ? round1(((current - previous) / previous) * 100) : null,
  });

  return {
    ok: true,
    range,
    generated_at: new Date().toISOString(),
    report_time_zone: "America/New_York",
    // Freshness probe: tells "no traffic in this range" apart from "no tracking
    // data reaching this database at all".
    latest_event_at: input.latestEventAt,
    total_events_all_time: input.totalEventsAllTime,
    totals: {
      visitors,
      sessions: sessionSet.size,
      chat_sessions: sessions.length,
      chat_messages: messages.length,
      leads: leads.length,
      lead_conversion_pct: pct(leads.length, visitors),
      avg_intent_score: avgIntentScore,
      ai_visitors: channelVisitors.get("AI assistant")?.size ?? 0,
      ai_leads: channelLeads.get("AI assistant") ?? 0,
      talk_page_visitors: talkVisitorSet.size,
      talk_page_views: talkPageViews,
      talk_form_starts: talkFormStarts,
      talk_email_captured: talkEmailCaptured,
    },
    previous_totals: previousTotals,
    deltas: {
      visitors: delta(visitors, previousTotals.visitors),
      chat_sessions: delta(sessions.length, previousTotals.chat_sessions),
      leads: delta(leads.length, previousTotals.leads),
    },
    trend,
    channels,
    ai_engines: aiEngines,
    top_utm_sources: tally(utmRows, 6).map((t) => ({
      source: t.key,
      count: t.count,
    })),
    top_topics: tally(
      leads.map((l) => ({ value: l.topic_interest })),
      6
    ).map((t) => ({ topic: t.key, count: t.count })),
    top_roles: tally(
      leads.map((l) => ({ value: l.role_signal })),
      6
    ).map((t) => ({ role: t.key, count: t.count })),
    top_pages: tally(
      events.map((e) => ({ value: e.path })),
      6
    ).map((t) => ({ path: t.key, count: t.count })),
    recent_leads: input.recentLeads.map((l) =>
      buildLeadSummary(l, channelOfLead)
    ),
    ...(input.truncated
      ? {
          truncated: true,
          note: "Event row cap reached — totals are an undercount.",
        }
      : {}),
  };
}

// ── Traffic trend ────────────────────────────────────────────────────────────

export function buildTrafficTrend(input: {
  range: Range;
  events: EventRow[];
  leads: Array<{ created_at: string }>;
  truncated: boolean;
}) {
  const days = buildReportDays(RANGE_DAYS[input.range]);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const visitorsPerDay = days.map(() => new Set<string>());
  const sessionsPerDay = days.map(() => new Set<string>());
  const viewsPerDay = days.map(() => 0);
  const leadsPerDay = days.map(() => 0);

  for (const e of input.events) {
    const idx = dayIndex.get(toReportDayKey(e.created_at));
    if (idx == null) continue;
    viewsPerDay[idx]++;
    if (e.visitor_id) visitorsPerDay[idx].add(e.visitor_id);
    if (e.session_id) sessionsPerDay[idx].add(e.session_id);
  }
  for (const l of input.leads) {
    const idx = dayIndex.get(toReportDayKey(l.created_at));
    if (idx != null) leadsPerDay[idx]++;
  }

  return {
    ok: true,
    range: input.range,
    report_time_zone: "America/New_York",
    days: days.map((day, i) => ({
      day,
      visitors: visitorsPerDay[i].size,
      sessions: sessionsPerDay[i].size,
      events: viewsPerDay[i],
      leads: leadsPerDay[i],
    })),
    ...(input.truncated ? { truncated: true } : {}),
  };
}

// ── Page engagement ──────────────────────────────────────────────────────────

export function buildPageEngagement(input: {
  range: Range;
  events: EventRow[];
  leads: Array<{
    id: string;
    visitor_id: string | null;
    page_history: unknown;
  }>;
  chatMessages: ChatMessageLike[];
  limit: number;
  truncated: boolean;
}) {
  const { events } = input;

  // First-touch path per visitor (events arrive ascending).
  const firstPathByVisitor = new Map<string, string>();
  for (const e of events) {
    if (!e.visitor_id || !e.path) continue;
    if (!firstPathByVisitor.has(e.visitor_id))
      firstPathByVisitor.set(e.visitor_id, e.path);
  }

  // Visitors whose first touch came from an AI assistant.
  const aiVisitorIds = new Set<string>();
  const seenVisitor = new Set<string>();
  for (const e of events) {
    if (!e.visitor_id || seenVisitor.has(e.visitor_id)) continue;
    seenVisitor.add(e.visitor_id);
    if (classifyChannel(e.referrer, e.utm).channel === "AI assistant") {
      aiVisitorIds.add(e.visitor_id);
    }
  }

  type Bucket = {
    visitors: Set<string>;
    views: number;
    chatSessions: number;
    leadsAttributed: number;
    aiVisitors: Set<string>;
  };
  const byPath = new Map<string, Bucket>();
  const bucket = (path: string): Bucket => {
    let b = byPath.get(path);
    if (!b) {
      b = {
        visitors: new Set(),
        views: 0,
        chatSessions: 0,
        leadsAttributed: 0,
        aiVisitors: new Set(),
      };
      byPath.set(path, b);
    }
    return b;
  };

  for (const e of events) {
    if (!e.path) continue;
    const b = bucket(e.path);
    b.views++;
    if (e.visitor_id) {
      b.visitors.add(e.visitor_id);
      if (aiVisitorIds.has(e.visitor_id)) b.aiVisitors.add(e.visitor_id);
    }
  }

  // Chat sessions per page: derive real conversations from chat_messages and
  // attribute each to the last page the visitor was on when it started.
  const pageTimelineByVisitor = buildPageTimelines(events);
  for (const s of deriveChatSessions(input.chatMessages)) {
    if (!s.visitor_id) continue;
    const path = pageAtInstant(
      pageTimelineByVisitor.get(s.visitor_id),
      s.started_at
    );
    if (path) bucket(path).chatSessions++;
  }

  // Attribute each lead to its first-touch path (falls back to page_history[0]).
  for (const l of input.leads) {
    let path: string | null = null;
    if (l.visitor_id) path = firstPathByVisitor.get(l.visitor_id) ?? null;
    if (!path && Array.isArray(l.page_history)) {
      const first = (l.page_history as unknown[])[0];
      if (first && typeof first === "object") {
        const rec = first as Record<string, unknown>;
        if (typeof rec.path === "string") path = rec.path;
        else if (typeof rec.url === "string") path = rec.url;
      }
    }
    if (path) bucket(path).leadsAttributed++;
  }

  const pages = [...byPath.entries()]
    .map(([path, b]) => ({
      path,
      visitors: b.visitors.size,
      views: b.views,
      chat_sessions: b.chatSessions,
      leads_attributed: b.leadsAttributed,
      ai_visitors: b.aiVisitors.size,
      conversion_pct: pct(b.leadsAttributed, b.visitors.size),
    }))
    .sort((a, b) => b.visitors - a.visitors)
    .slice(0, input.limit);

  return {
    ok: true,
    range: input.range,
    total_paths: byPath.size,
    pages,
    ...(input.truncated ? { truncated: true } : {}),
  };
}

/** Ascending `{ ts, path }` timeline per visitor, for "what page were they on". */
function buildPageTimelines(
  events: Array<{
    visitor_id: string | null;
    path: string | null;
    created_at: string;
  }>
): Map<string, Array<{ ts: number; path: string }>> {
  const byVisitor = new Map<string, Array<{ ts: number; path: string }>>();
  for (const e of events) {
    if (!e.visitor_id || !e.path) continue;
    const list = byVisitor.get(e.visitor_id) ?? [];
    list.push({ ts: new Date(e.created_at).getTime(), path: e.path });
    byVisitor.set(e.visitor_id, list);
  }
  return byVisitor;
}

/** The last page seen at or before `at`, falling back to the first known page. */
function pageAtInstant(
  timeline: Array<{ ts: number; path: string }> | undefined,
  at: string
): string | null {
  if (!timeline?.length) return null;
  const target = new Date(at).getTime();
  let path = timeline[0].path;
  for (const p of timeline) {
    if (p.ts <= target) path = p.path;
    else break;
  }
  return path;
}

// ── Conversion insights ──────────────────────────────────────────────────────

export function buildConversionInsights(input: {
  range: Range;
  leads: Array<{ id: string; created_at: string; visitor_id: string | null }>;
  events: Array<{
    visitor_id: string | null;
    created_at: string;
    path: string | null;
    session_id: string | null;
  }>;
  truncated: boolean;
}) {
  const convertedAtByVisitor = new Map<string, number>();
  for (const l of input.leads) {
    if (!l.visitor_id) continue;
    const t = new Date(l.created_at).getTime();
    const prev = convertedAtByVisitor.get(l.visitor_id);
    if (prev == null || t < prev) convertedAtByVisitor.set(l.visitor_id, t);
  }

  type Agg = {
    first: string | null;
    lastBefore: string | null;
    pages: number;
    sessions: Set<string>;
    firstAt: number | null;
    paths: Set<string>;
  };
  const byVisitor = new Map<string, Agg>();

  for (const e of input.events) {
    if (!e.visitor_id) continue;
    const convertedAt = convertedAtByVisitor.get(e.visitor_id);
    const at = new Date(e.created_at).getTime();
    if (convertedAt != null && at > convertedAt) continue; // pre-conversion only

    let a = byVisitor.get(e.visitor_id);
    if (!a) {
      a = {
        first: null,
        lastBefore: null,
        pages: 0,
        sessions: new Set(),
        firstAt: null,
        paths: new Set(),
      };
      byVisitor.set(e.visitor_id, a);
    }
    if (!a.first && e.path) a.first = e.path;
    if (a.firstAt == null) a.firstAt = at;
    if (e.path) {
      a.pages++;
      a.lastBefore = e.path;
      a.paths.add(e.path);
    }
    if (e.session_id) a.sessions.add(e.session_id);
  }

  const entryTally: Array<{ value: string | null }> = [];
  const lastTally: Array<{ value: string | null }> = [];
  const pagesCounts: number[] = [];
  const sessionCounts: number[] = [];
  const times: number[] = [];

  const convertedPaths = new Map<string, number>();
  const nonConvertedPaths = new Map<string, number>();
  let convertedVisitors = 0;
  let nonConvertedVisitors = 0;

  for (const [visitorId, a] of byVisitor) {
    const convertedAt = convertedAtByVisitor.get(visitorId);
    if (convertedAt != null) {
      convertedVisitors++;
      entryTally.push({ value: a.first });
      lastTally.push({ value: a.lastBefore });
      pagesCounts.push(a.pages);
      sessionCounts.push(a.sessions.size || (a.pages > 0 ? 1 : 0));
      if (a.firstAt != null)
        times.push(Math.max(0, (convertedAt - a.firstAt) / 60000));
      for (const p of a.paths)
        convertedPaths.set(p, (convertedPaths.get(p) ?? 0) + 1);
    } else {
      nonConvertedVisitors++;
      for (const p of a.paths)
        nonConvertedPaths.set(p, (nonConvertedPaths.get(p) ?? 0) + 1);
    }
  }

  // Pages that converting visitors saw disproportionately often. Requires at
  // least 2 converting visitors on the page so a single lead can't top the list.
  const pageLift = [...convertedPaths.entries()]
    .filter(([, c]) => c >= 2)
    .map(([path, c]) => {
      const convertedShare = convertedVisitors ? c / convertedVisitors : 0;
      const nonConvertedShare = nonConvertedVisitors
        ? (nonConvertedPaths.get(path) ?? 0) / nonConvertedVisitors
        : 0;
      return {
        path,
        converted_share_pct: round1(convertedShare * 100),
        non_converted_share_pct: round1(nonConvertedShare * 100),
        lift_pct: round1((convertedShare - nonConvertedShare) * 100),
      };
    })
    .sort((a, b) => b.lift_pct - a.lift_pct)
    .slice(0, 8);

  return {
    leads_analyzed: convertedVisitors,
    avg_pages_to_convert: avg(pagesCounts),
    avg_sessions_to_convert: avg(sessionCounts),
    median_time_to_convert_minutes: median(times),
    entry_pages: tally(entryTally, 6).map((t) => ({
      path: t.key,
      count: t.count,
    })),
    last_page_before_form: tally(lastTally, 6).map((t) => ({
      path: t.key,
      count: t.count,
    })),
    page_lift: pageLift,
    ...(input.truncated ? { truncated: true } : {}),
  };
}

// ── Lead journeys ────────────────────────────────────────────────────────────

export type JourneyLeadRow = {
  id: string;
  email: string | null;
  name: string | null;
  institution: string | null;
  created_at: string;
  visitor_id: string | null;
  page_history: unknown;
  utm: unknown;
  utm_first?: unknown;
  utm_last?: unknown;
  event_type?: string | null;
  channel?: string | null;
};

type RawJourneyEvent = {
  created_at: string;
  path: string | null;
  referrer: string | null;
  event_type: string;
  session_id: string | null;
  utm: unknown;
};

/** Adds dwell time (gap to the next event, capped) to an ascending event list. */
function withDwell<T extends { created_at: string }>(
  rows: T[]
): Array<T & { dwellSeconds: number | null }> {
  return rows.map((r, i) => {
    const next = rows[i + 1];
    if (!next) return { ...r, dwellSeconds: null };
    const secs = Math.round(
      (new Date(next.created_at).getTime() - new Date(r.created_at).getTime()) /
        1000
    );
    return {
      ...r,
      dwellSeconds: secs >= 0 ? Math.min(secs, MAX_DWELL_SECONDS) : null,
    };
  });
}

/**
 * `leads` stores one row per action (form_submit, meeting_booked), so rows are
 * grouped into people first — one person = one visitor_id, falling back to the
 * lowercased email — and the limit applies to people, not rows.
 */
export function groupLeadRowsIntoPeople(
  rows: JourneyLeadRow[],
  limit: number
): JourneyLeadRow[][] {
  const groups = new Map<string, JourneyLeadRow[]>();
  for (const r of rows) {
    const key = r.visitor_id
      ? `v:${r.visitor_id}`
      : `e:${(r.email ?? "").toLowerCase()}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  return [...groups.values()]
    .map((list) =>
      list.slice().sort((a, b) => a.created_at.localeCompare(b.created_at))
    )
    .sort((a, b) =>
      (b[b.length - 1]?.created_at ?? "").localeCompare(
        a[a.length - 1]?.created_at ?? ""
      )
    )
    .slice(0, limit);
}

export function buildLeadJourneys(input: {
  range: Range;
  people: JourneyLeadRow[][];
  eventsByVisitor: Map<string, RawJourneyEvent[]>;
  chatVisitors: Set<string>;
  includeEvents: boolean;
  insights: ReturnType<typeof buildConversionInsights>;
}) {
  const leads = input.people.map((rows) => {
    const earliest = rows[0];
    const submitRows = rows.filter(
      (r) => (r.event_type ?? "form_submit") === "form_submit"
    );
    const bookingRows = rows.filter((r) => r.event_type === "meeting_booked");
    // Prefer the row that actually carries the person's details.
    const identity = rows.find((r) => !!r.name || !!r.institution) ?? earliest;
    const anchor = submitRows[0] ?? earliest;
    const bookingRow = bookingRows[bookingRows.length - 1] ?? null;

    // The Cal.com booking payload rides along in the meeting row's page_history.
    let booking: Record<string, string | null> | null = null;
    if (bookingRow && Array.isArray(bookingRow.page_history)) {
      const entry = (bookingRow.page_history as unknown[]).find(
        (e) =>
          !!e &&
          typeof e === "object" &&
          (e as Record<string, unknown>).type === "cal_booking"
      ) as Record<string, unknown> | undefined;
      if (entry) {
        const s = (v: unknown) =>
          typeof v === "string" && v.trim() ? v : null;
        booking = {
          uid: s(entry.uid),
          start_time: s(entry.startTime),
          end_time: s(entry.endTime),
          event_type: s(entry.eventType),
          reschedule_uri: s(entry.reschedule_uri) ?? s(entry.rescheduleUri),
        };
      }
    }

    const visitorId = rows.find((r) => !!r.visitor_id)?.visitor_id ?? null;
    const email = identity.email ?? anchor.email;
    const name = identity.name ?? null;
    const institution = identity.institution ?? null;

    let raw: RawJourneyEvent[] = visitorId
      ? (input.eventsByVisitor.get(visitorId) ?? [])
      : [];

    // Older rows predate analytics_events — fall back to the lead's own
    // page_history JSON so the journey isn't simply empty.
    if (raw.length === 0 && Array.isArray(anchor.page_history)) {
      raw = (anchor.page_history as unknown[])
        .map((entry): RawJourneyEvent | null => {
          if (!entry || typeof entry !== "object") return null;
          const e = entry as Record<string, unknown>;
          return {
            created_at:
              typeof e.timestamp === "string"
                ? e.timestamp
                : typeof e.created_at === "string"
                  ? e.created_at
                  : anchor.created_at,
            path:
              typeof e.path === "string"
                ? e.path
                : typeof e.url === "string"
                  ? e.url
                  : null,
            referrer: typeof e.referrer === "string" ? e.referrer : null,
            event_type:
              typeof e.event_type === "string" ? e.event_type : "page_view",
            session_id: typeof e.session_id === "string" ? e.session_id : null,
            utm: null,
          };
        })
        .filter((v): v is RawJourneyEvent => v !== null)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    const convertedAt = new Date(anchor.created_at).getTime();
    const dwelled = withDwell(raw);
    const events = dwelled.map((e) => ({
      created_at: e.created_at,
      path: e.path,
      referrer: e.referrer,
      event_type: e.event_type,
      session_id: e.session_id,
      dwell_seconds: e.dwellSeconds,
      phase: (new Date(e.created_at).getTime() <= convertedAt
        ? "pre"
        : "post") as "pre" | "post",
    }));

    const pre = events.filter((e) => e.phase === "pre");
    const first = pre[0] ?? null;

    // Dwell-ranked interests across the pre-conversion path.
    const interest = new Map<string, { seconds: number; views: number }>();
    for (const e of pre) {
      if (!e.path) continue;
      const cur = interest.get(e.path) ?? { seconds: 0, views: 0 };
      cur.seconds += e.dwell_seconds ?? 0;
      cur.views += 1;
      interest.set(e.path, cur);
    }
    const topInterests = [...interest.entries()]
      .map(([path, v]) => ({ path, seconds: v.seconds, views: v.views }))
      .sort((a, b) => b.seconds - a.seconds || b.views - a.views)
      .slice(0, 5);

    const sessionsToConvert = new Set(
      pre.map((e) => e.session_id).filter((s): s is string => !!s)
    ).size;

    const verdict = classifyTestLead({ email, name, institution });

    return {
      id: anchor.id,
      email,
      name,
      institution,
      created_at: anchor.created_at,
      visitor_id: visitorId,
      status: bookingRow ? "meeting_scheduled" : "form_submitted",
      form_submitted_at: submitRows[0]?.created_at ?? null,
      meeting_booked_at: bookingRow?.created_at ?? null,
      booking,
      channel_name:
        typeof earliest.channel === "string" && earliest.channel.trim()
          ? earliest.channel
          : null,
      utm_first: earliest.utm_first ? readUtmFields(earliest.utm_first) : null,
      utm_last: earliest.utm_last ? readUtmFields(earliest.utm_last) : null,
      entry: first
        ? (() => {
            const utm = dwelled[0]?.utm ?? anchor.utm;
            const c = classifyChannel(first.referrer, utm);
            return {
              path: first.path,
              referrer: first.referrer,
              utm_source: readUtmFields(utm).source,
              channel: c.channel,
              channel_label: c.label,
            };
          })()
        : null,
      time_to_convert_seconds: first
        ? Math.max(
            0,
            Math.round(
              (convertedAt - new Date(first.created_at).getTime()) / 1000
            )
          )
        : null,
      sessions_to_convert: sessionsToConvert || (pre.length > 0 ? 1 : 0),
      pages_before_conversion: pre.filter((e) => !!e.path).length,
      last_pages_before_form: pre
        .filter((e) => !!e.path)
        .slice(-3)
        .map((e) => e.path as string),
      top_interests: topInterests,
      chatted_before_conversion:
        (visitorId ? input.chatVisitors.has(visitorId) : false) ||
        pre.some((e) => e.event_type.startsWith("chat")),
      is_test: verdict.isTest,
      test_reasons: verdict.reasons,
      // The full replay is large; it is opt-in via `include_events`.
      ...(input.includeEvents ? { events } : { event_count: events.length }),
    };
  });

  return {
    ok: true,
    range: input.range,
    insights: input.insights,
    leads,
  };
}

/** Visitors who chatted, from either real sessions or messages. */
export function chatVisitors(
  sessions: Array<{ visitor_id?: string | null }>,
  messages: ChatMessageLike[]
): Set<string> {
  return chatVisitorsFrom(sessions, messages);
}

// ── Chat conversations ───────────────────────────────────────────────────────

type ChatRow = {
  id: string;
  role: string;
  content: string | null;
  sources: unknown;
  session_id: string | null;
  visitor_id: string | null;
  created_at: string;
};

function sourceLabelsOf(sources: unknown): string[] {
  if (!sources) return [];
  const list = Array.isArray(sources) ? sources : [sources];
  const labels: string[] = [];
  for (const s of list) {
    if (typeof s === "string") labels.push(s);
    else if (s && typeof s === "object") {
      const rec = s as Record<string, unknown>;
      const label = rec.title ?? rec.path ?? rec.url ?? rec.source ?? rec.slug;
      if (typeof label === "string" && label.trim()) labels.push(label.trim());
    }
  }
  return [...new Set(labels)].slice(0, 4);
}

const isUserRole = (role: string) => /user|visitor|human/i.test(role);

export function buildChatConversations(input: {
  range: Range;
  messages: ChatRow[];
  events: Array<{
    visitor_id: string | null;
    path: string | null;
    created_at: string;
  }>;
  leads: Array<{
    id: string;
    email: string | null;
    name: string | null;
    visitor_id: string | null;
  }>;
  limit: number;
  includeTranscripts: boolean;
  sessionId?: string | null;
}) {
  // Group into conversations: real session_id when present, otherwise the
  // visitor with a 30-minute inactivity split (same rule as the KPI counts).
  const gapMs = SESSION_GAP_MINUTES * 60 * 1000;
  const byKey = new Map<string, ChatRow[]>();
  for (const m of input.messages) {
    const key =
      m.session_id ?? (m.visitor_id ? `v:${m.visitor_id}` : "unattributed");
    const list = byKey.get(key);
    if (list) list.push(m);
    else byKey.set(key, [m]);
  }

  type Group = { key: string; derived: boolean; rows: ChatRow[] };
  const groups: Group[] = [];
  for (const [key, list] of byKey) {
    const derived = !list[0]?.session_id;
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (!derived) {
      groups.push({ key, derived: false, rows: list });
      continue;
    }
    let current: Group | null = null;
    let lastTs = 0;
    for (const m of list) {
      const ts = new Date(m.created_at).getTime();
      if (!current || ts - lastTs > gapMs) {
        current = { key: `${key}@${m.created_at}`, derived: true, rows: [] };
        groups.push(current);
      }
      current.rows.push(m);
      lastTs = ts;
    }
  }
  groups.sort((a, b) =>
    (b.rows[0]?.created_at ?? "").localeCompare(a.rows[0]?.created_at ?? "")
  );

  const leadByVisitor = new Map<
    string,
    { id: string; email: string | null; name: string | null }
  >();
  for (const l of input.leads) {
    if (l.visitor_id && !leadByVisitor.has(l.visitor_id)) {
      leadByVisitor.set(l.visitor_id, {
        id: l.id,
        email: l.email,
        name: l.name,
      });
    }
  }
  const pageTimelineByVisitor = buildPageTimelines(input.events);

  const selected = input.sessionId
    ? groups.filter((g) => g.key === input.sessionId)
    : groups.slice(0, input.limit);

  const conversations = selected.map((g) => {
    const first = g.rows[0];
    const last = g.rows[g.rows.length - 1];
    const visitorId = first?.visitor_id ?? null;
    const userMsgs = g.rows.filter((m) => isUserRole(m.role));
    const assistantMsgs = g.rows.filter((m) => !isUserRole(m.role));

    return {
      id: g.key,
      visitor_id: visitorId,
      started_at: first?.created_at ?? "",
      ended_at: last?.created_at ?? "",
      message_count: g.rows.length,
      user_message_count: userMsgs.length,
      first_question: userMsgs[0]?.content
        ? snippet(userMsgs[0].content, 180)
        : null,
      duration_seconds:
        first && last
          ? Math.max(
              0,
              Math.round(
                (new Date(last.created_at).getTime() -
                  new Date(first.created_at).getTime()) /
                  1000
              )
            )
          : 0,
      derived: g.derived,
      entry_path: visitorId
        ? pageAtInstant(
            pageTimelineByVisitor.get(visitorId),
            first?.created_at ?? ""
          )
        : null,
      lead: visitorId ? (leadByVisitor.get(visitorId) ?? null) : null,
      // A conversation the bot answered without citing anything is a likely
      // content gap worth reviewing.
      unanswered:
        assistantMsgs.length > 0 &&
        assistantMsgs.every((m) => sourceLabelsOf(m.sources).length === 0),
      ...(input.includeTranscripts || input.sessionId
        ? {
            messages: g.rows.map((m) => {
              const labels = sourceLabelsOf(m.sources);
              return {
                id: m.id,
                role: m.role,
                content: m.content ?? "",
                created_at: m.created_at,
                has_sources: labels.length > 0,
                source_labels: labels,
              };
            }),
          }
        : {}),
    };
  });

  // Topic clustering runs over every question in the selected conversations.
  const questions: QuestionInput[] = [];
  for (const g of selected) {
    for (const m of g.rows) {
      if (isUserRole(m.role) && (m.content ?? "").trim()) {
        questions.push({ conversationId: g.key, text: m.content as string });
      }
    }
  }

  const totalMessages = selected.reduce((s, g) => s + g.rows.length, 0);
  const withLead = conversations.filter((c) => c.lead).length;

  return {
    ok: true,
    range: input.range,
    totals: {
      conversations: conversations.length,
      total_conversations_in_range: groups.length,
      messages: totalMessages,
      user_messages: questions.length,
      avg_messages_per_conversation: conversations.length
        ? round1(totalMessages / conversations.length)
        : null,
      conversations_with_lead: withLead,
      lead_rate_pct: pct(withLead, conversations.length),
      unanswered_conversations: conversations.filter((c) => c.unanswered)
        .length,
    },
    top_asks: buildTopAsks(questions, 10),
    topics: buildTopicBuckets(questions),
    conversations,
  };
}
