/**
 * Vendored verbatim from cotribute/webmaster `src/lib/report-day.ts`.
 *
 * Eastern-time report-day bucketing. Every daily number in the admin dashboard
 * is bucketed this way; Switchboard must match it or the two disagree.
 */
/**
 * Reporting day boundaries.
 *
 * All analytics rows are stored as UTC timestamps, but the portal is read by a
 * US-Eastern team. Bucketing on the UTC calendar date meant that at 8pm ET a
 * brand-new "day" opened with almost no data (so the last bar on every chart
 * read as ~0), and 8pm–midnight ET traffic was filed onto the next day.
 *
 * Everything here derives the offset per timestamp via Intl, so DST is handled
 * without hardcoding -4/-5.
 */

export const REPORT_TIME_ZONE = "America/New_York";
export const REPORT_TIME_ZONE_LABEL = "ET";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `YYYY-MM-DD` calendar date of a UTC timestamp in the reporting time zone. */
export function toReportDayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  // en-CA formats as YYYY-MM-DD.
  return dayFormatter.format(d);
}

/** Today's reporting-day key. */
export function currentReportDayKey(): string {
  return toReportDayKey(new Date());
}

const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Milliseconds the reporting zone is offset from UTC at a given instant. */
function zoneOffsetMs(at: Date): number {
  const parts = offsetFormatter.formatToParts(at);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return asUtc - at.getTime();
}

/** The UTC instant at which local midnight of `dayKey` begins. */
export function reportDayStartUtc(dayKey: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  const naive = Date.UTC(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  // First guess with the offset at the naive instant, then refine once in case
  // the guess landed on the other side of a DST transition.
  let offset = zoneOffsetMs(new Date(naive));
  let candidate = new Date(naive - offset);
  offset = zoneOffsetMs(candidate);
  candidate = new Date(naive - offset);
  return candidate;
}

/** Adds `delta` calendar days to a `YYYY-MM-DD` key (DST-safe). */
export function shiftReportDay(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + delta));
  return shifted.toISOString().slice(0, 10);
}

/**
 * The last `count` reporting days, ascending, ending with today (local).
 * `endDayKey` lets callers build an earlier window for period-over-period.
 */
export function buildReportDays(
  count: number,
  endDayKey = currentReportDayKey()
): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(shiftReportDay(endDayKey, -i));
  return out;
}

/** Formats a `YYYY-MM-DD` key without re-parsing through the viewer's zone. */
export function formatReportDay(
  dayKey: string,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  }
): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) return dayKey;
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
