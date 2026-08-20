// Pure post-processing for db_list_customer_users — no DB, no I/O, so it can be
// driven directly from scratch/*.mjs. Mirrors the fgp-utilization.ts split.

export interface CustomerUserRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  fi_slug: string | null;
  fi_name: string | null;
  roles: string | null;
  login_verified?: boolean;
  created_at?: Date | string | null;
}

// The CSV column order. `id` first because Customer.io treats the leading
// identifier column as the person key on import.
export const CUSTOMER_USER_COLUMNS = [
  "id",
  "email",
  "first_name",
  "last_name",
  "fi_slug",
  "fi_name",
  "roles",
] as const;

/**
 * RFC-4180 CSV, header row included, CRLF line endings (what Customer.io's
 * importer expects). null/undefined render as an empty field. No name in prod
 * needs quoting today, but a real escaper is the difference between a clean
 * import and a silently shifted column three months from now.
 */
export function toCsv(
  columns: readonly string[],
  rows: Record<string, unknown>[]
): string {
  const lines = [columns.map(escapeField).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeField(row[c])).join(","));
  }
  return lines.join("\r\n");
}

function escapeField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * One row per email address, case-insensitively. The same person can hold
 * accounts at several FIs (16 such emails in prod today) — sending them the
 * same broadcast twice is the bug this prevents. The earliest-created row
 * survives and carries the FIs/roles of the rows folded into it, so the person
 * stays segmentable by every FI they belong to.
 *
 * Rows with no email can be neither deduped nor mailed; they pass through
 * untouched so they stay visible in the export instead of collapsing together.
 */
export function dedupeByEmail(rows: CustomerUserRow[]): CustomerUserRow[] {
  const byEmail = new Map<string, CustomerUserRow>();
  // Output order: first appearance of each email, with email-less rows kept in
  // place relative to the emails around them.
  const order: Array<{ key: string } | { row: CustomerUserRow }> = [];

  for (const row of rows) {
    const key = (row.email ?? "").trim().toLowerCase();
    if (!key) {
      order.push({ row: { ...row } });
      continue;
    }

    const existing = byEmail.get(key);
    if (!existing) {
      order.push({ key });
      byEmail.set(key, { ...row });
      continue;
    }

    const [survivor, folded] =
      createdAtMs(row) < createdAtMs(existing)
        ? [row, existing]
        : [existing, row];
    byEmail.set(key, {
      ...survivor,
      fi_slug: mergeList(survivor.fi_slug, folded.fi_slug),
      fi_name: mergeList(survivor.fi_name, folded.fi_name),
      roles: mergeList(survivor.roles, folded.roles),
    });
  }

  return order.map((entry) =>
    "key" in entry ? byEmail.get(entry.key)! : entry.row
  );
}

function createdAtMs(row: CustomerUserRow): number {
  const t = new Date(row.created_at ?? 0).getTime();
  // Rows with an unparseable created_at sort last so a real date always wins.
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

// Semicolon-joined, de-duplicated, order preserved. Inputs are themselves
// already semicolon-joined (roles) or single values (fi_slug).
function mergeList(a: string | null, b: string | null): string | null {
  const parts = [...(a ?? "").split(";"), ...(b ?? "").split(";")]
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out = parts.filter((p) => !seen.has(p) && seen.add(p));
  return out.length ? out.join(";") : null;
}
