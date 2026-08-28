/**
 * Vendored from cotribute/webmaster `src/lib/attr-report.ts` — the read-only
 * subset. The link-builder half of that file (slug generation, tagged-URL
 * construction, destination validation) writes to `attr_links` and is
 * deliberately left behind: this module only ever reads.
 */

export type AttributionMode = "first" | "last" | "all";

export type AttrChannel = {
  value: string;
  label: string;
  description: string | null;
  medium: string | null;
  owner_team: string;
  is_acquisition: boolean;
  requires_campaign: boolean;
  is_self_tagging: boolean;
  sort_order: number;
  active: boolean;
};

export type AttributionRow = {
  visitor_id: string;
  first_channel: string | null;
  first_at: string | null;
  last_channel: string | null;
  last_at: string | null;
  became_lead: boolean | null;
};

export type ChannelRow = {
  value: string;
  label: string;
  visitors: number;
  leads: number;
  /** null when visitors === 0 — rendered as an em-dash, not 0%. */
  leadRate: number | null;
  isAcquisition: boolean;
  isSelfTagging: boolean;
  /**
   * True when this channel value carries traffic but has no row in attr_channels.
   * The label is then a derived guess and the acquisition side is unknown — the UI
   * must mark the row so nobody reads it as legitimate metadata.
   */
  metadataMissing: boolean;
  /** True when attr_channels marks the channel inactive but traffic still arrived. */
  inactive: boolean;
  /** Number of touches in the window. Only set when mode is "all". */
  touches?: number;
};

export type RawSourceRow = { source: string; visitors: number };
export type DomainRow = { domain: string; visitors: number };

export type ChannelPerformance = {
  mode: AttributionMode;
  acquisition: ChannelRow[];
  /** Every non-acquisition channel, not just the first one found. */
  inPlatform: ChannelRow[];
  direct: ChannelRow;
  unrecognized: ChannelRow & { sources: RawSourceRow[] };
  untaggedDomains: DomainRow[];
  totalVisitors: number;
  totalLeads: number;
  /** Share of all leads in the window that arrived with no channel. */
  directLeadShare: number;
};

const EXCLUDED_DOMAIN_FRAGMENTS = [
  "cotribute.com",
  "cotributemail.com",
  "google.",
  "bing.com",
  "duckduckgo.com",
  "yahoo.",
  "search.brave.com",
  "ecosia.org",
  "baidu.com",
  "yandex.",
  "startpage.com",
  "qwant.com",
];

export function isReportableReferrerDomain(
  domain: string | null | undefined
): boolean {
  const d = (domain ?? "").trim().toLowerCase();
  if (!d) return false;
  return !EXCLUDED_DOMAIN_FRAGMENTS.some((f) => d.includes(f));
}

function emptyRow(
  value: string,
  label: string,
  isAcquisition: boolean
): ChannelRow {
  return {
    value,
    label,
    visitors: 0,
    leads: 0,
    leadRate: null,
    touches: 0,
    isAcquisition,
    isSelfTagging: false,
    metadataMissing: false,
    inactive: false,
  };
}

function rate(leads: number, visitors: number): number | null {
  if (visitors <= 0) return null;
  return leads / visitors;
}

/** Fallback label for a channel value with no attr_channels row, e.g. "cs-email" → "Cs Email". */
export function prettifyChannelValue(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Cohorts by touch date (not lead-creation date) so numerator and denominator
 * describe the same population of visitors.
 */
export function buildChannelPerformance(input: {
  mode: AttributionMode;
  rows: AttributionRow[];
  channels: AttrChannel[];
  rawSources: Array<{ raw_source: string | null; visitor_id: string }>;
  directDomains: Array<{ referrer_domain: string | null; visitor_id: string }>;
}): ChannelPerformance {
  const { mode, rows, channels } = input;

  type Bucket = { visitors: Set<string>; leads: Set<string> };
  const byChannel = new Map<string, Bucket>();

  let totalVisitors = 0;
  let totalLeads = 0;

  for (const r of rows) {
    const channel =
      (mode === "first" ? r.first_channel : r.last_channel) ?? "direct";
    let bucket = byChannel.get(channel);
    if (!bucket) {
      bucket = { visitors: new Set(), leads: new Set() };
      byChannel.set(channel, bucket);
    }
    bucket.visitors.add(r.visitor_id);
    totalVisitors += 1;
    if (r.became_lead) {
      bucket.leads.add(r.visitor_id);
      totalLeads += 1;
    }
  }

  const toRow = (
    value: string,
    label: string,
    isAcquisition: boolean,
    opts: {
      isSelfTagging?: boolean;
      metadataMissing?: boolean;
      inactive?: boolean;
    } = {}
  ): ChannelRow => {
    const b = byChannel.get(value);
    const visitors = b?.visitors.size ?? 0;
    const leads = b?.leads.size ?? 0;
    return {
      value,
      label,
      visitors,
      leads,
      leadRate: rate(leads, visitors),
      isAcquisition,
      isSelfTagging: opts.isSelfTagging ?? false,
      metadataMissing: opts.metadataMissing ?? false,
      inactive: opts.inactive ?? false,
    };
  };

  const RESERVED = new Set(["direct", "unrecognized"]);

  /**
   * Metadata is a label lookup, never a filter. A channel is reported when it has
   * a row in attr_channels OR when traffic arrived under its value:
   *  - inactive channels that carry traffic still render (marked `inactive`);
   *    filtering `active` on the metadata side only silently dropped their numbers.
   *  - values with no metadata row at all render with a derived label and
   *    `metadataMissing`, so the UI can show them as broken rather than plausible.
   */
  const reportable = channels.filter((c) => c.active || byChannel.has(c.value));

  const byRate = (a: ChannelRow, b: ChannelRow) => {
    // Unused channels (no visitors) sink to the bottom rather than reading as 0%.
    if (a.leadRate === null && b.leadRate === null)
      return b.visitors - a.visitors;
    if (a.leadRate === null) return 1;
    if (b.leadRate === null) return -1;
    if (b.leadRate !== a.leadRate) return b.leadRate - a.leadRate;
    return b.visitors - a.visitors;
  };

  const known = new Set(channels.map((c) => c.value));
  const orphanValues = [...byChannel.keys()].filter(
    (v) => !known.has(v) && !RESERVED.has(v)
  );
  /**
   * Orphans are assumed acquisition — there is no way to know their true side of
   * the divider, so they are marked and must not be read as ranked channels.
   */
  const orphanRows: ChannelRow[] = orphanValues.map((value) =>
    toRow(value, prettifyChannelValue(value), true, { metadataMissing: true })
  );

  const acquisition = [
    ...reportable
      .filter((c) => c.is_acquisition)
      .map((c) =>
        toRow(c.value, c.label, true, {
          isSelfTagging: c.is_self_tagging,
          inactive: !c.active,
        })
      ),
    ...orphanRows,
  ].sort(byRate);

  // Every non-acquisition channel gets a row. Previously only the first match survived.
  const inPlatform = reportable
    .filter((c) => !c.is_acquisition)
    .map((c) =>
      toRow(c.value, c.label, false, {
        isSelfTagging: c.is_self_tagging,
        inactive: !c.active,
      })
    )
    .sort(byRate);

  const direct = byChannel.has("direct")
    ? toRow("direct", "Direct / untagged", false)
    : emptyRow("direct", "Direct / untagged", false);

  const unrecognizedBase = byChannel.has("unrecognized")
    ? toRow("unrecognized", "Unrecognized", false)
    : emptyRow("unrecognized", "Unrecognized", false);

  const sourceMap = new Map<string, Set<string>>();
  for (const t of input.rawSources) {
    const key = (t.raw_source ?? "").trim();
    if (!key) continue;
    let set = sourceMap.get(key);
    if (!set) {
      set = new Set();
      sourceMap.set(key, set);
    }
    set.add(t.visitor_id);
  }
  const sources: RawSourceRow[] = [...sourceMap.entries()]
    .map(([source, set]) => ({ source, visitors: set.size }))
    .sort((a, b) => b.visitors - a.visitors);

  const domainMap = new Map<string, Set<string>>();
  for (const t of input.directDomains) {
    const domain = (t.referrer_domain ?? "").trim().toLowerCase();
    if (!isReportableReferrerDomain(domain)) continue;
    let set = domainMap.get(domain);
    if (!set) {
      set = new Set();
      domainMap.set(domain, set);
    }
    set.add(t.visitor_id);
  }
  const untaggedDomains: DomainRow[] = [...domainMap.entries()]
    .map(([domain, set]) => ({ domain, visitors: set.size }))
    .sort((a, b) => b.visitors - a.visitors)
    .slice(0, 25);

  return {
    mode,
    acquisition,
    inPlatform,
    direct,
    unrecognized: { ...unrecognizedBase, sources },
    untaggedDomains,
    totalVisitors,
    totalLeads,
    directLeadShare: totalLeads > 0 ? direct.leads / totalLeads : 0,
  };
}

/**
 * All-touch attribution: every touch in the window gets credited to its channel.
 * A visitor who touched multiple channels appears in each one. Visitors and
 * leads remain unique counts per channel, so the lead rate is still comparable
 * to first/last touch, while the `touches` column shows the volume of effort.
 */
export function buildAllTouchPerformance(input: {
  channels: AttrChannel[];
  touches: Array<{
    visitor_id: string;
    channel_value: string | null;
    occurred_at: string;
  }>;
  conversions: Array<{ visitor_id: string; became_lead: boolean | null }>;
  rawSources: Array<{ raw_source: string | null; visitor_id: string }>;
  directDomains: Array<{ referrer_domain: string | null; visitor_id: string }>;
}): ChannelPerformance {
  const { channels, touches } = input;

  type Bucket = { visitors: Set<string>; leads: Set<string>; touches: number };
  const byChannel = new Map<string, Bucket>();

  const conversionMap = new Map<string, boolean>();
  for (const c of input.conversions) {
    conversionMap.set(c.visitor_id, !!c.became_lead);
  }

  const allVisitors = new Set<string>();
  const allLeads = new Set<string>();

  for (const t of touches) {
    const value = t.channel_value ?? "direct";
    let bucket = byChannel.get(value);
    if (!bucket) {
      bucket = { visitors: new Set(), leads: new Set(), touches: 0 };
      byChannel.set(value, bucket);
    }
    bucket.touches += 1;
    bucket.visitors.add(t.visitor_id);
    allVisitors.add(t.visitor_id);
    if (conversionMap.get(t.visitor_id)) {
      bucket.leads.add(t.visitor_id);
      allLeads.add(t.visitor_id);
    }
  }

  const toRow = (
    value: string,
    label: string,
    isAcquisition: boolean,
    opts: {
      isSelfTagging?: boolean;
      metadataMissing?: boolean;
      inactive?: boolean;
    } = {}
  ): ChannelRow => {
    const b = byChannel.get(value);
    const visitors = b?.visitors.size ?? 0;
    const leads = b?.leads.size ?? 0;
    return {
      value,
      label,
      visitors,
      leads,
      leadRate: rate(leads, visitors),
      touches: b?.touches ?? 0,
      isAcquisition,
      isSelfTagging: opts.isSelfTagging ?? false,
      metadataMissing: opts.metadataMissing ?? false,
      inactive: opts.inactive ?? false,
    };
  };

  const RESERVED = new Set(["direct", "unrecognized"]);

  const reportable = channels.filter((c) => c.active || byChannel.has(c.value));

  const byRate = (a: ChannelRow, b: ChannelRow) => {
    // Unused channels (no visitors) sink to the bottom rather than reading as 0%.
    if (a.leadRate === null && b.leadRate === null)
      return b.visitors - a.visitors;
    if (a.leadRate === null) return 1;
    if (b.leadRate === null) return -1;
    if (b.leadRate !== a.leadRate) return b.leadRate - a.leadRate;
    return b.visitors - a.visitors;
  };

  const known = new Set(channels.map((c) => c.value));
  const orphanValues = [...byChannel.keys()].filter(
    (v) => !known.has(v) && !RESERVED.has(v)
  );
  const orphanRows: ChannelRow[] = orphanValues.map((value) =>
    toRow(value, prettifyChannelValue(value), true, { metadataMissing: true })
  );

  const acquisition = [
    ...reportable
      .filter((c) => c.is_acquisition)
      .map((c) =>
        toRow(c.value, c.label, true, {
          isSelfTagging: c.is_self_tagging,
          inactive: !c.active,
        })
      ),
    ...orphanRows,
  ].sort(byRate);

  const inPlatform = reportable
    .filter((c) => !c.is_acquisition)
    .map((c) =>
      toRow(c.value, c.label, false, {
        isSelfTagging: c.is_self_tagging,
        inactive: !c.active,
      })
    )
    .sort(byRate);

  const direct = byChannel.has("direct")
    ? toRow("direct", "Direct / untagged", false)
    : emptyRow("direct", "Direct / untagged", false);

  const unrecognizedBase = byChannel.has("unrecognized")
    ? toRow("unrecognized", "Unrecognized", false)
    : emptyRow("unrecognized", "Unrecognized", false);

  const sourceMap = new Map<string, Set<string>>();
  for (const t of input.rawSources) {
    const key = (t.raw_source ?? "").trim();
    if (!key) continue;
    let set = sourceMap.get(key);
    if (!set) {
      set = new Set();
      sourceMap.set(key, set);
    }
    set.add(t.visitor_id);
  }
  const sources: RawSourceRow[] = [...sourceMap.entries()]
    .map(([source, set]) => ({ source, visitors: set.size }))
    .sort((a, b) => b.visitors - a.visitors);

  const domainMap = new Map<string, Set<string>>();
  for (const t of input.directDomains) {
    const domain = (t.referrer_domain ?? "").trim().toLowerCase();
    if (!isReportableReferrerDomain(domain)) continue;
    let set = domainMap.get(domain);
    if (!set) {
      set = new Set();
      domainMap.set(domain, set);
    }
    set.add(t.visitor_id);
  }
  const untaggedDomains: DomainRow[] = [...domainMap.entries()]
    .map(([domain, set]) => ({ domain, visitors: set.size }))
    .sort((a, b) => b.visitors - a.visitors)
    .slice(0, 25);

  return {
    mode: "all",
    acquisition,
    inPlatform,
    direct,
    unrecognized: { ...unrecognizedBase, sources },
    untaggedDomains,
    totalVisitors: allVisitors.size,
    totalLeads: allLeads.size,
    directLeadShare: allLeads.size > 0 ? direct.leads / allLeads.size : 0,
  };
}
