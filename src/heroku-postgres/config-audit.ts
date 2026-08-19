// Pure aggregation, classification and redaction for the config-change audit
// tools. No DB, no IO — the handler fetches lean rows and this module turns
// them into the compact answer, so the raw audit rows never reach the model
// context (same split as fgp-utilization.ts).

import {
  LARGE_PAYLOAD_ITEM_TYPES,
  NO_FI_ITEM_TYPES,
  PII_ITEM_TYPES,
} from "./config-audit-sql.js";

export type Trail = "internal" | "portal";

/** One lean audit row as returned by SQL_CONFIG_AUDIT_SEARCH. */
export type AuditRow = {
  trail: Trail;
  id: string | number;
  item_type: string;
  item_id: string | null;
  event: string;
  occurred_at: string | Date;
  actor_raw: string;
  ip: string | null;
  fi_id: string | null;
  fi_name: string | null;
  item_label: string | null;
};

/**
 * How an actor is classified.
 *
 * `sysadmin` — Cotribute staff, per the canonical hasSysadminAccess rule
 *              (admins row holding the "[Acquire] Applications Portal"
 *              permission group).
 * `client`   — everyone else acting in the portal.
 * `system`   — a `versions` row with a blank whodunnit: a background job,
 *              console session or API write with no signed-in admin.
 */
export type ActorKind = "sysadmin" | "client" | "system";

export type ActorRef = {
  actor_key: string;
  display_name: string;
  email: string | null;
  kind: ActorKind;
  admin_id?: string | null;
  financial_user_ids?: string[];
};

export type Session = {
  trail: Trail;
  actor: { display_name: string; email: string | null; kind: ActorKind };
  fi: { id: string; name: string | null } | null;
  item_type: string;
  item_id: string | null;
  item_label: string | null;
  events: string[];
  revisions: number;
  first_at: string;
  last_at: string;
  changed_keys: string[];
  changed_key_count: number;
  noop_only: boolean;
  max_change_bytes: number | null;
  detail_ids: { first: string; last: string; all_count: number };
  possible_cross_trail_dupe?: true;
};

/** Keys that mean "nothing a human changed" — PaperTrail bookkeeping. */
const NOOP_KEYS = new Set(["updated_at", "lock_version"]);

/**
 * Key names whose VALUES are never returned. Matched case-insensitively
 * against every segment of the dotted path, so nested keys are caught too.
 * The key name itself is still shown — that is the audit signal.
 */
const KEY_DENYLIST =
  /(ssn|social_security|tax_id|\bein\b|dob|birth|driver|license|passport|password|pwd|secret|token|api[_-]?key|credential|client_secret|private_key|encrypted|ciphertext|_iv$|salt|account_number|routing|card_number|cvv|email|phone|mobile|street|address|first_name|last_name|middle_name|full_name)/i;

/** Value shapes that look like PII/secrets regardless of the key name. */
const VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "email"],
  [/^\d{3}-?\d{2}-?\d{4}$/, "ssn_like"],
  [/^\$2[aby]\$\d{2}\$/, "bcrypt"],
  [/^ey[A-Za-z0-9_-]{10,}\./, "jwt"],
  [/^[A-Za-z0-9+/=_-]{64,}$/, "high_entropy"],
];

const MAX_VALUE_CHARS = 500;
const MAX_RESPONSE_BYTES = 40_000;
const MAX_PATHS_PER_KEY = 40;
const MAX_KEYS_PER_SESSION = 12;

export function isPiiItemType(itemType: string): boolean {
  return PII_ITEM_TYPES.includes(itemType);
}

export function isLargePayloadItemType(itemType: string): boolean {
  return LARGE_PAYLOAD_ITEM_TYPES.includes(itemType);
}

export function expectsNoFi(itemType: string): boolean {
  return NO_FI_ITEM_TYPES.includes(itemType);
}

/** "jdawson@cotributemail.com" → "J Dawson". Last resort only. */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return (
    local
      .split(/[._+-]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || email
  );
}

/**
 * Classify a portal actor. `isSysadmin` comes straight from the SQL join
 * against the "[Acquire] Applications Portal" permission group — this function
 * never inspects the email domain.
 */
export function classifyPortalActor(isSysadmin: boolean): ActorKind {
  return isSysadmin ? "sysadmin" : "client";
}

function toIso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/**
 * Collapse PaperTrail's one-row-per-save into editing sessions.
 *
 * Seven consecutive `Flow|update` rows by the same person one minute apart are
 * one edit, not seven changes. Rows group by (trail, actor, item_type, item_id)
 * and split whenever the gap between consecutive rows exceeds `gapMinutes`.
 */
export function rollupSessions(
  rows: AuditRow[],
  opts: {
    gapMinutes?: number;
    actors: Map<string, ActorRef>;
    changedKeys?: Map<string, { keys: string[]; bytes: number | null }>;
  }
): Session[] {
  const gapMs = (opts.gapMinutes ?? 30) * 60_000;
  const keyed = new Map<string, AuditRow[]>();

  for (const row of rows) {
    const k = `${row.trail}::${row.actor_raw}::${row.item_type}::${row.item_id ?? ""}`;
    const bucket = keyed.get(k);
    if (bucket) bucket.push(row);
    else keyed.set(k, [row]);
  }

  const sessions: Session[] = [];

  for (const bucket of keyed.values()) {
    bucket.sort((a, b) => +new Date(a.occurred_at) - +new Date(b.occurred_at));

    let run: AuditRow[] = [];
    const flush = () => {
      if (run.length > 0) sessions.push(buildSession(run, opts));
      run = [];
    };

    for (const row of bucket) {
      if (run.length === 0) {
        run.push(row);
        continue;
      }
      const prev = run[run.length - 1];
      const delta = +new Date(row.occurred_at) - +new Date(prev.occurred_at);
      if (delta > gapMs) flush();
      run.push(row);
    }
    flush();
  }

  sessions.sort((a, b) => +new Date(b.last_at) - +new Date(a.last_at));
  return sessions;
}

function buildSession(
  run: AuditRow[],
  opts: {
    actors: Map<string, ActorRef>;
    changedKeys?: Map<string, { keys: string[]; bytes: number | null }>;
  }
): Session {
  const first = run[0];
  const last = run[run.length - 1];
  const actor = opts.actors.get(actorKeyOf(first));

  const keyCounts = new Map<string, number>();
  let maxBytes: number | null = null;
  let sawKeys = false;

  for (const row of run) {
    const info = opts.changedKeys?.get(changeKey(row.trail, row.id));
    if (!info) continue;
    sawKeys = true;
    if (info.bytes != null)
      maxBytes = maxBytes == null ? info.bytes : Math.max(maxBytes, info.bytes);
    for (const key of info.keys) {
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    }
  }

  const ranked = [...keyCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);

  const meaningful = ranked.filter((k) => !NOOP_KEYS.has(k));

  return {
    trail: first.trail,
    actor: {
      display_name: actor?.display_name ?? "Unknown",
      email: actor?.email ?? null,
      kind: actor?.kind ?? (first.trail === "internal" ? "system" : "client"),
    },
    fi: first.fi_id ? { id: first.fi_id, name: first.fi_name } : null,
    item_type: first.item_type,
    item_id: first.item_id,
    item_label: run.find((r) => r.item_label)?.item_label ?? null,
    events: [...new Set(run.map((r) => r.event))],
    revisions: run.length,
    first_at: toIso(first.occurred_at),
    last_at: toIso(last.occurred_at),
    changed_keys: meaningful.slice(0, MAX_KEYS_PER_SESSION),
    changed_key_count: meaningful.length,
    // Only claim "no-op" when we actually looked at the keys — a session with
    // no key data is unknown, not empty.
    noop_only: sawKeys && meaningful.length === 0,
    max_change_bytes: maxBytes,
    detail_ids: {
      first: String(first.id),
      last: String(last.id),
      all_count: run.length,
    },
  };
}

/** Map key for an actor. The only place this format is defined. */
export function actorKey(trail: Trail, actorRaw: string): string {
  return `${trail}::${actorRaw}`;
}

export function actorKeyOf(row: AuditRow): string {
  return actorKey(row.trail, row.actor_raw);
}

/** Map key for one audit row's changed-key lookup. */
export function changeKey(trail: Trail, id: string | number): string {
  return `${trail}::${id}`;
}

/**
 * Flag sessions where the same record was touched in both trails within a few
 * seconds — one logical change that may have been recorded twice. We don't
 * think the two apps double-write, but asserting that silently would be worse
 * than reporting it.
 */
export function flagCrossTrailDupes(sessions: Session[], windowMs = 5_000) {
  const byItem = new Map<string, Session[]>();
  for (const s of sessions) {
    const k = `${s.item_type}::${s.item_id ?? ""}`;
    const bucket = byItem.get(k);
    if (bucket) bucket.push(s);
    else byItem.set(k, [s]);
  }
  for (const bucket of byItem.values()) {
    if (bucket.length < 2) continue;
    for (const a of bucket) {
      for (const b of bucket) {
        if (a === b || a.trail === b.trail) continue;
        if (
          Math.abs(+new Date(a.first_at) - +new Date(b.first_at)) <= windowMs
        ) {
          a.possible_cross_trail_dupe = true;
        }
      }
    }
  }
}

export type Summary = {
  by_actor: Array<{
    display_name: string;
    email: string | null;
    kind: ActorKind;
    sessions: number;
    rows: number;
    first_at: string;
    last_at: string;
  }>;
  by_fi: Array<{
    fi_id: string | null;
    fi_name: string | null;
    sessions: number;
    rows: number;
  }>;
  by_item_type: Array<{
    item_type: string;
    sessions: number;
    rows: number;
    creates: number;
    updates: number;
    destroys: number;
  }>;
  by_month: Array<{ month: string; sessions: number; rows: number }>;
  by_actor_kind: Array<{ kind: ActorKind; sessions: number; rows: number }>;
};

/** Rollups over every session in the window — not just the returned page. */
export function summarize(sessions: Session[]): Summary {
  const live = sessions.filter((s) => !s.noop_only);

  const actor = new Map<string, Summary["by_actor"][number]>();
  const fi = new Map<string, Summary["by_fi"][number]>();
  const type = new Map<string, Summary["by_item_type"][number]>();
  const month = new Map<string, Summary["by_month"][number]>();
  const kind = new Map<ActorKind, Summary["by_actor_kind"][number]>();

  for (const s of live) {
    const aKey = s.actor.email ?? s.actor.display_name;
    const a = actor.get(aKey);
    if (a) {
      a.sessions += 1;
      a.rows += s.revisions;
      if (s.first_at < a.first_at) a.first_at = s.first_at;
      if (s.last_at > a.last_at) a.last_at = s.last_at;
    } else {
      actor.set(aKey, {
        display_name: s.actor.display_name,
        email: s.actor.email,
        kind: s.actor.kind,
        sessions: 1,
        rows: s.revisions,
        first_at: s.first_at,
        last_at: s.last_at,
      });
    }

    const fKey = s.fi?.id ?? "__unattributed__";
    const f = fi.get(fKey);
    if (f) {
      f.sessions += 1;
      f.rows += s.revisions;
    } else {
      fi.set(fKey, {
        fi_id: s.fi?.id ?? null,
        fi_name: s.fi?.name ?? null,
        sessions: 1,
        rows: s.revisions,
      });
    }

    const t = type.get(s.item_type) ?? {
      item_type: s.item_type,
      sessions: 0,
      rows: 0,
      creates: 0,
      updates: 0,
      destroys: 0,
    };
    t.sessions += 1;
    t.rows += s.revisions;
    if (s.events.includes("create")) t.creates += 1;
    if (s.events.includes("update")) t.updates += 1;
    if (s.events.includes("destroy")) t.destroys += 1;
    type.set(s.item_type, t);

    const mKey = s.last_at.slice(0, 7);
    const m = month.get(mKey) ?? { month: mKey, sessions: 0, rows: 0 };
    m.sessions += 1;
    m.rows += s.revisions;
    month.set(mKey, m);

    const k = kind.get(s.actor.kind) ?? {
      kind: s.actor.kind,
      sessions: 0,
      rows: 0,
    };
    k.sessions += 1;
    k.rows += s.revisions;
    kind.set(s.actor.kind, k);
  }

  const bySessions = (x: { sessions: number }, y: { sessions: number }) =>
    y.sessions - x.sessions;

  return {
    by_actor: [...actor.values()].sort(bySessions),
    by_fi: [...fi.values()].sort(bySessions),
    by_item_type: [...type.values()].sort(bySessions),
    by_month: [...month.values()].sort((a, b) =>
      a.month.localeCompare(b.month)
    ),
    by_actor_kind: [...kind.values()].sort(bySessions),
  };
}

// ── Diff rendering ──────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A PaperTrail change entry is `[before, after]`. */
function isChangePair(v: unknown): v is [unknown, unknown] {
  return Array.isArray(v) && v.length === 2;
}

function pushPath(out: string[], path: string) {
  if (out.length < MAX_PATHS_PER_KEY) out.push(path || "(root)");
}

function diffPaths(a: unknown, b: unknown, prefix: string, out: string[]) {
  if (out.length >= MAX_PATHS_PER_KEY) return;

  if (isPlainObject(a) && isPlainObject(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      diffPaths(a[key], b[key], prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      diffPaths(a[i], b[i], `${prefix}[${i}]`, out);
    }
    return;
  }

  if (JSON.stringify(a) !== JSON.stringify(b)) pushPath(out, prefix);
}

/**
 * Changed JSON paths for one top-level key, with no values. This is what makes
 * a 242KB Flow diff answerable — "9 paths changed under steps[3]" is the thing
 * a human actually wants.
 *
 * Handles both payload shapes: settings-api writes `{ key: [before, after] }`,
 * while the back-office application editor writes a nested
 * `{ meta: { responses: [before, after] } }`.
 */
export function structuralDiff(value: unknown): {
  changed_paths: string[];
  changed_path_count: number;
} {
  const out: string[] = [];

  const walk = (node: unknown, prefix: string) => {
    if (isChangePair(node)) {
      diffPaths(node[0], node[1], prefix, out);
      return;
    }
    if (isPlainObject(node)) {
      for (const key of Object.keys(node)) {
        walk(node[key], prefix ? `${prefix}.${key}` : key);
      }
      return;
    }
    pushPath(out, prefix);
  };

  walk(value, "");
  const unique = [...new Set(out)];
  return { changed_paths: unique, changed_path_count: unique.length };
}

export type RedactedChange = {
  key: string;
  kind: "added" | "removed" | "modified";
  from?: unknown;
  to?: unknown;
  changed_paths?: string[];
  changed_path_count?: number;
  redacted?: "item_type_denylist" | "key_denylist" | "value_pattern";
  truncated?: true;
};

function pathIsDenied(path: string): boolean {
  return path.split(/[.[\]]+/).some((seg) => seg && KEY_DENYLIST.test(seg));
}

function redactValue(
  value: unknown,
  path: string
): { value: unknown; redacted?: RedactedChange["redacted"]; truncated?: true } {
  if (value === null || value === undefined) return { value };

  if (pathIsDenied(path)) {
    return { value: "«redacted»", redacted: "key_denylist" };
  }

  if (typeof value === "string") {
    for (const [pattern] of VALUE_PATTERNS) {
      if (pattern.test(value)) {
        return { value: "«redacted»", redacted: "value_pattern" };
      }
    }
    if (value.length > MAX_VALUE_CHARS) {
      return {
        value: `${value.slice(0, MAX_VALUE_CHARS)}…(truncated, ${value.length} chars)`,
        truncated: true,
      };
    }
    return { value };
  }

  if (Array.isArray(value)) {
    const mapped = value.map((v, i) => redactValue(v, `${path}[${i}]`));
    return {
      value: mapped.map((m) => m.value),
      redacted: mapped.find((m) => m.redacted)?.redacted,
      truncated: mapped.some((m) => m.truncated) ? true : undefined,
    };
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    let redacted: RedactedChange["redacted"];
    let truncated: true | undefined;
    for (const [k, v] of Object.entries(value)) {
      const r = redactValue(v, path ? `${path}.${k}` : k);
      out[k] = r.value;
      redacted = redacted ?? r.redacted;
      truncated = truncated ?? r.truncated;
    }
    return { value: out, redacted, truncated };
  }

  return { value };
}

/**
 * Turn one row's `object_changes` into the drill-in payload.
 *
 * `structural` mode never emits a value. `values` mode emits redacted,
 * truncated values and is refused outright for PII-bearing item_types, and for
 * the large config types unless the caller narrowed to a few keys — that last
 * rule is what keeps a 242KB Flow diff safe by construction rather than by
 * hoping the caller asks nicely.
 */
export function renderChanges(
  itemType: string,
  objectChanges: unknown,
  opts: { mode: "structural" | "values"; keys?: string[] }
): {
  mode: "structural" | "values";
  changes: RedactedChange[];
  omitted_keys: Array<{ key: string; bytes: number }>;
  values_withheld?: true;
  withheld_reason?: string;
  notes: string[];
} {
  const notes: string[] = [];
  const source = isPlainObject(objectChanges) ? objectChanges : {};
  const requested = opts.keys?.length ? new Set(opts.keys) : null;

  let mode = opts.mode;
  let valuesWithheld: true | undefined;
  let withheldReason: string | undefined;

  if (mode === "values" && isPiiItemType(itemType)) {
    mode = "structural";
    valuesWithheld = true;
    withheldReason =
      `${itemType} change payloads carry applicant PII or integration secrets, ` +
      "so values are never returned. Field-level encryption does not cover them — " +
      "names, dates of birth, document numbers and password hashes are stored in " +
      "the clear alongside the one encrypted SSN blob. Decrypted or applicant-level " +
      "data is owned by the coadmin-api module.";
  } else if (
    mode === "values" &&
    isLargePayloadItemType(itemType) &&
    (!requested || requested.size > 3)
  ) {
    mode = "structural";
    notes.push(
      `${itemType} diffs can exceed 200KB, so values mode requires narrowing to ` +
        "3 or fewer keys via `keys`. Returning structural paths instead."
    );
  }

  const entries = Object.entries(source).filter(
    ([key]) => !requested || requested.has(key)
  );

  const changes: RedactedChange[] = [];
  const omitted: Array<{ key: string; bytes: number }> = [];
  let budget = MAX_RESPONSE_BYTES;

  // Smallest first, so a single huge key can't starve everything else.
  entries.sort(
    ([, a], [, b]) =>
      JSON.stringify(a ?? null).length - JSON.stringify(b ?? null).length
  );

  for (const [key, value] of entries) {
    const bytes = JSON.stringify(value ?? null).length;

    if (budget <= 0) {
      omitted.push({ key, bytes });
      continue;
    }

    const pair = isChangePair(value) ? value : null;
    const kind: RedactedChange["kind"] =
      pair && (pair[0] === null || pair[0] === undefined)
        ? "added"
        : pair && (pair[1] === null || pair[1] === undefined)
          ? "removed"
          : "modified";

    if (mode === "structural") {
      const { changed_paths, changed_path_count } = structuralDiff(value);
      const entry: RedactedChange = {
        key,
        kind,
        changed_paths,
        changed_path_count,
      };
      if (valuesWithheld) entry.redacted = "item_type_denylist";
      changes.push(entry);
      budget -= JSON.stringify(entry).length;
      continue;
    }

    const fromR = redactValue(pair ? pair[0] : value, key);
    const toR = redactValue(pair ? pair[1] : value, key);
    const entry: RedactedChange = {
      key,
      kind,
      from: fromR.value,
      to: toR.value,
    };
    const redacted = fromR.redacted ?? toR.redacted;
    if (redacted) entry.redacted = redacted;
    if (fromR.truncated || toR.truncated) entry.truncated = true;

    const size = JSON.stringify(entry).length;
    if (size > budget) {
      omitted.push({ key, bytes });
      continue;
    }
    changes.push(entry);
    budget -= size;
  }

  if (omitted.length > 0) {
    notes.push(
      `${omitted.length} key(s) omitted to stay inside the response budget. ` +
        "Re-request them by name via `keys`."
    );
  }

  return {
    mode,
    changes,
    omitted_keys: omitted,
    ...(valuesWithheld ? { values_withheld: valuesWithheld } : {}),
    ...(withheldReason ? { withheld_reason: withheldReason } : {}),
    notes,
  };
}
