/**
 * Vendored verbatim from cotribute/webmaster `src/lib/chat-sessions.ts`.
 *
 * These are the exact classification rules the admin dashboard uses. They are
 * copied rather than re-derived so Switchboard's numbers reconcile with what
 * GTM sees in the portal. If the portal's copy changes, re-copy this file.
 */
/**
 * Chat session derivation.
 *
 * The website currently writes `chat_messages` rows but does not create a
 * `chat_sessions` row per conversation, and does not stamp `session_id` on the
 * messages. That makes "chat sessions" read as 0 next to dozens of messages.
 *
 * Until the source app is fixed, we derive sessions from the messages
 * themselves: group by conversation key (`session_id` when present, otherwise
 * `visitor_id`) and split whenever there is a gap longer than
 * SESSION_GAP_MINUTES between consecutive messages.
 *
 * If real `chat_sessions` rows ever start arriving, they win — see
 * `resolveChatSessions`.
 */

export const SESSION_GAP_MINUTES = 30;

export type ChatMessageLike = {
  session_id?: string | null;
  visitor_id?: string | null;
  created_at: string;
};

export type DerivedChatSession = {
  visitor_id: string | null;
  started_at: string;
  endedAt: string;
  messageCount: number;
  derived: boolean;
};

export function deriveChatSessions(
  messages: ChatMessageLike[]
): DerivedChatSession[] {
  const gapMs = SESSION_GAP_MINUTES * 60 * 1000;
  const byKey = new Map<string, ChatMessageLike[]>();

  for (const m of messages) {
    const key = m.session_id ?? (m.visitor_id ? `v:${m.visitor_id}` : null);
    if (!key) continue;
    const list = byKey.get(key);
    if (list) list.push(m);
    else byKey.set(key, [m]);
  }

  const sessions: DerivedChatSession[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    let current: DerivedChatSession | null = null;
    let lastTs = 0;
    for (const m of list) {
      const ts = new Date(m.created_at).getTime();
      if (!current || ts - lastTs > gapMs) {
        current = {
          visitor_id: m.visitor_id ?? null,
          started_at: m.created_at,
          endedAt: m.created_at,
          messageCount: 0,
          derived: true,
        };
        sessions.push(current);
      }
      current.messageCount++;
      current.endedAt = m.created_at;
      lastTs = ts;
    }
  }

  sessions.sort((a, b) => a.started_at.localeCompare(b.started_at));
  return sessions;
}

/** Prefer real session rows; fall back to derivation when the table is empty. */
export function resolveChatSessions(
  realSessions: Array<{ visitor_id?: string | null; started_at: string }>,
  messages: ChatMessageLike[]
): DerivedChatSession[] {
  if (realSessions.length > 0) {
    return realSessions.map((s) => ({
      visitor_id: s.visitor_id ?? null,
      started_at: s.started_at,
      endedAt: s.started_at,
      messageCount: 0,
      derived: false,
    }));
  }
  return deriveChatSessions(messages);
}

/** Visitors who chatted, whether or not real session rows exist. */
export function chatVisitorsFrom(
  realSessions: Array<{ visitor_id?: string | null }>,
  messages: ChatMessageLike[]
): Set<string> {
  const set = new Set<string>();
  for (const s of realSessions) if (s.visitor_id) set.add(s.visitor_id);
  for (const m of messages) if (m.visitor_id) set.add(m.visitor_id);
  return set;
}
