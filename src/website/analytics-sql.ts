/**
 * SQL for the website-analytics module.
 *
 * Every statement is a hardcoded string with `$n` placeholders — identifiers are
 * never interpolated from tool input. The one place a fragment is substituted
 * (`buildBreakdownSql`) picks it out of a closed map keyed by an allowlisted
 * dimension name; the caller's value never reaches the string.
 *
 * Window semantics match cotribute/webmaster's `windowStart()`: the window opens
 * at Eastern midnight `days - 1` days ago, so both the earliest day and today
 * are fully inside it. `timezone('America/New_York', now())` yields naive ET,
 * and wrapping the truncated result in `timezone(...)` converts back to an
 * instant — DST-safe without hardcoding -4/-5.
 */

/** Resolves `$1` = number of days into the current and previous window starts. */
const WINDOW_CTE = `
  WITH w AS (
    SELECT
      timezone(
        'America/New_York',
        date_trunc('day', timezone('America/New_York', now()))
          - make_interval(days => $1::int - 1)
      ) AS start_at,
      timezone(
        'America/New_York',
        date_trunc('day', timezone('America/New_York', now()))
          - make_interval(days => 2 * $1::int - 1)
      ) AS prev_start_at
  )
`;

/** Events in the current window. `$2` caps rows so a runaway range can't blow up the dyno. */
export const EVENTS_IN_WINDOW = `${WINDOW_CTE}
  SELECT e.visitor_id, e.session_id, e.event_type, e.path, e.referrer, e.utm,
         e.user_agent, e.created_at
  FROM analytics_events e, w
  WHERE e.created_at >= w.start_at
  ORDER BY e.created_at ASC
  LIMIT $2::int
`;

/** Visitor ids only, for the prior equal-length window (period-over-period deltas). */
export const PREV_EVENTS_IN_WINDOW = `${WINDOW_CTE}
  SELECT e.visitor_id, e.created_at
  FROM analytics_events e, w
  WHERE e.created_at >= w.prev_start_at AND e.created_at < w.start_at
  ORDER BY e.created_at ASC
  LIMIT $2::int
`;

export const CHAT_SESSIONS_IN_WINDOW = `${WINDOW_CTE}
  SELECT s.id, s.visitor_id, s.started_at
  FROM chat_sessions s, w
  WHERE s.started_at >= w.start_at
  ORDER BY s.started_at ASC
`;

export const PREV_CHAT_SESSIONS_IN_WINDOW = `${WINDOW_CTE}
  SELECT s.id, s.visitor_id, s.started_at
  FROM chat_sessions s, w
  WHERE s.started_at >= w.prev_start_at AND s.started_at < w.start_at
  ORDER BY s.started_at ASC
`;

export const CHAT_MESSAGES_IN_WINDOW = `${WINDOW_CTE}
  SELECT m.id, m.session_id, m.visitor_id, m.created_at
  FROM chat_messages m, w
  WHERE m.created_at >= w.start_at
  ORDER BY m.created_at ASC
`;

export const PREV_CHAT_MESSAGES_IN_WINDOW = `${WINDOW_CTE}
  SELECT m.id, m.session_id, m.visitor_id, m.created_at
  FROM chat_messages m, w
  WHERE m.created_at >= w.prev_start_at AND m.created_at < w.start_at
  ORDER BY m.created_at ASC
`;

/** Full message bodies — only the conversations tool needs these. */
export const CHAT_MESSAGES_FULL_IN_WINDOW = `${WINDOW_CTE}
  SELECT m.id, m.role, m.content, m.sources, m.session_id, m.visitor_id, m.created_at
  FROM chat_messages m, w
  WHERE m.created_at >= w.start_at
  ORDER BY m.created_at ASC
`;

export const LEADS_IN_WINDOW = `${WINDOW_CTE}
  SELECT l.id, l.created_at, l.visitor_id, l.email, l.name, l.institution,
         l.intent_score, l.topic_interest, l.role_signal, l.channel,
         l.utm, l.utm_first, l.utm_last, l.event_type
  FROM leads l, w
  WHERE l.created_at >= w.start_at
  ORDER BY l.created_at ASC
`;

export const PREV_LEADS_IN_WINDOW = `${WINDOW_CTE}
  SELECT l.id, l.created_at
  FROM leads l, w
  WHERE l.created_at >= w.prev_start_at AND l.created_at < w.start_at
  ORDER BY l.created_at ASC
`;

/** Leads plus `page_history`, for lead attribution and journey replay. */
export const LEADS_WITH_HISTORY_IN_WINDOW = `${WINDOW_CTE}
  SELECT l.id, l.created_at, l.visitor_id, l.email, l.name, l.institution,
         l.page_history, l.utm, l.utm_first, l.utm_last, l.channel, l.event_type
  FROM leads l, w
  WHERE l.created_at >= w.start_at
  ORDER BY l.created_at DESC
  LIMIT $2::int
`;

/** Newest leads regardless of range — the dashboard's "recent leads" list. */
export const RECENT_LEADS = `
  SELECT l.id, l.email, l.name, l.institution, l.role_signal, l.topic_interest,
         l.intent_score, l.created_at, l.utm, l.visitor_id
  FROM leads l
  ORDER BY l.created_at DESC
  LIMIT $1::int
`;

/**
 * All-time freshness probe. Distinguishes "no traffic in this range" from
 * "this credential cannot read the table at all" — without it a blocked read
 * and a quiet week look identical.
 */
export const EVENTS_FRESHNESS = `
  SELECT max(created_at) AS latest_event_at, count(*)::bigint AS total_events_all_time
  FROM analytics_events
`;

/** Full visitor history (not clipped to the window) for a named set of visitors. */
export const EVENTS_FOR_VISITORS = `
  SELECT e.visitor_id, e.created_at, e.path, e.referrer, e.event_type,
         e.session_id, e.utm
  FROM analytics_events e
  WHERE e.visitor_id = ANY($1::text[])
  ORDER BY e.created_at ASC
  LIMIT $2::int
`;

export const CHAT_SESSIONS_FOR_VISITORS = `
  SELECT s.visitor_id, s.started_at
  FROM chat_sessions s
  WHERE s.visitor_id = ANY($1::text[])
  ORDER BY s.started_at ASC
`;

export const CHAT_MESSAGES_FOR_VISITORS = `
  SELECT m.visitor_id, m.session_id, m.created_at
  FROM chat_messages m
  WHERE m.visitor_id = ANY($1::text[])
  ORDER BY m.created_at ASC
`;

export const LEADS_FOR_VISITORS = `
  SELECT l.id, l.email, l.name, l.visitor_id, l.created_at
  FROM leads l
  WHERE l.visitor_id = ANY($1::text[])
  ORDER BY l.created_at ASC
`;

// ── Attribution (attr_* tables and views) ────────────────────────────────────

export const ATTR_CHANNELS = `
  SELECT value, label, description, medium, owner_team, is_acquisition,
         requires_campaign, is_self_tagging, sort_order, active
  FROM attr_channels
  ORDER BY sort_order ASC
`;

/**
 * `$2` is the touch column to filter on — 'first_at' or 'last_at'. It is not
 * interpolated: both branches of the CASE are written out, so the parameter
 * only ever selects between two hardcoded columns.
 */
export const ATTR_VISITOR_ATTRIBUTION = `${WINDOW_CTE}
  SELECT a.visitor_id, a.first_channel, a.first_at, a.last_channel, a.last_at,
         a.became_lead
  FROM attr_visitor_attribution a, w
  WHERE (CASE WHEN $2::text = 'first' THEN a.first_at ELSE a.last_at END) >= w.start_at
  ORDER BY 1
`;

/** Every visitor's conversion flag, unfiltered — the all-touch mode's denominator. */
export const ATTR_CONVERSIONS = `
  SELECT visitor_id, became_lead
  FROM attr_visitor_attribution
`;

export const ATTR_TOUCHES_RESOLVED = `${WINDOW_CTE}
  SELECT t.visitor_id, t.channel_value, t.occurred_at
  FROM attr_touch_resolved t, w
  WHERE t.occurred_at >= w.start_at
  ORDER BY t.occurred_at ASC
`;

export const ATTR_UNRECOGNIZED_SOURCES = `${WINDOW_CTE}
  SELECT t.raw_source, t.visitor_id
  FROM attr_touch_resolved t, w
  WHERE t.occurred_at >= w.start_at AND t.channel_value = 'unrecognized'
  ORDER BY t.occurred_at ASC
`;

export const ATTR_DIRECT_DOMAINS = `${WINDOW_CTE}
  SELECT t.referrer_domain, t.visitor_id
  FROM attr_touch_resolved t, w
  WHERE t.occurred_at >= w.start_at
    AND t.channel_value = 'direct'
    AND t.referrer_domain IS NOT NULL
  ORDER BY t.occurred_at ASC
`;

// ── Ad-hoc breakdown ─────────────────────────────────────────────────────────

/**
 * The dimensions `web_events_breakdown` will group by, and the SQL that
 * computes each. This map is the allowlist: a `group_by` value that is not a
 * key here never reaches the query builder.
 */
export const BREAKDOWN_DIMENSIONS: Record<string, string> = {
  path: "e.path",
  event_type: "e.event_type",
  channel: "e.channel",
  referrer_domain:
    "nullif(split_part(regexp_replace(lower(coalesce(e.referrer, '')), '^https?://(www\\.)?', ''), '/', 1), '')",
  utm_source: "coalesce(e.utm->>'source', e.utm->>'utm_source')",
  utm_medium: "coalesce(e.utm->>'medium', e.utm->>'utm_medium')",
  utm_campaign: "coalesce(e.utm->>'campaign', e.utm->>'utm_campaign')",
  device:
    "CASE WHEN e.user_agent ~* '(ipad|tablet)' THEN 'tablet' " +
    "WHEN e.user_agent ~* '(mobile|iphone|android|ipod)' THEN 'mobile' " +
    "WHEN e.user_agent IS NULL OR e.user_agent = '' THEN NULL ELSE 'desktop' END",
  report_day: "(e.created_at AT TIME ZONE 'America/New_York')::date::text",
};

export const BREAKDOWN_DIMENSION_NAMES = Object.keys(BREAKDOWN_DIMENSIONS);

/**
 * Builds the breakdown query for an already-validated dimension.
 *
 * Params: `$1` days, `$2` event_type filter (nullable), `$3` path prefix
 * (nullable), `$4` limit. Values stay parameters; only the dimension's own SQL
 * — taken from BREAKDOWN_DIMENSIONS above — is substituted.
 */
export function buildBreakdownSql(dimension: string): string {
  const fragment = BREAKDOWN_DIMENSIONS[dimension];
  if (!fragment) {
    throw new Error(`Unknown breakdown dimension: ${dimension}`);
  }
  return `${WINDOW_CTE}
  SELECT ${fragment} AS bucket,
         count(*)::bigint AS events,
         count(DISTINCT e.visitor_id)::bigint AS visitors,
         count(DISTINCT e.session_id)::bigint AS sessions
  FROM analytics_events e, w
  WHERE e.created_at >= w.start_at
    AND ($2::text IS NULL OR e.event_type = $2::text)
    AND ($3::text IS NULL OR e.path LIKE $3::text || '%')
  GROUP BY 1
  HAVING ${fragment} IS NOT NULL
  ORDER BY events DESC, visitors DESC
  LIMIT $4::int
`;
}
