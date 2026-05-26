// Per-applicant dedup + billable/non-billable classification for the
// /generate-fgp-utilization Cowork skill.
//
// FraudGuard+ is billed per APPLICANT, per inquiry: for one person, an Effectiv
// fraud check OR a Plaid IDV session (OR both) counts as ONE billable inquiry.
// Joint applicants and beneficial owners on the same application are SEPARATE
// inquiries.
//
// This module is a pure function over lean candidate rows fetched by the handler.
// Keeping it pure (no DB, no IO) makes the billing logic unit-testable and lets
// the handler return compact per-FI aggregates instead of shipping ~20k raw rows
// through the model context.
//
// Attribution key — the unit of dedup is (onboarding_application_id, person).
// The canonical person key is normalized firstName|lastName|dob. Plaid IDV never
// captures SSN and its dominant slug ("govt-id") is a template type rather than a
// per-person discriminator, so name+dob is the only signal that reliably matches
// the same person ACROSS vendors. SSN/slug are weaker fallbacks only.

export interface EffectivCandidate {
  uuid: string;
  app_id: string;
  fi_id: string;
  fi_name: string;
  fi_slug: string;
  is_demo: boolean;
  slug: string | null;
  first_name: string | null;
  last_name: string | null;
  dob: string | null;
  ssn_last4: string | null;
  reached_fraud_step: boolean;
  decision: string | null;
  created_at: string;
}

export interface PlaidCandidate {
  uuid: string;
  app_id: string;
  fi_id: string;
  fi_name: string;
  fi_slug: string;
  is_demo: boolean;
  slug: string | null;
  first_name: string | null;
  last_name: string | null;
  dob: string | null;
  status: string | null;
  document_status: string | null;
  identity_verification_id: string | null;
  source: "document" | "initiation";
  created_at: string;
}

type Vendor = "effectiv" | "plaid";
type KeyConfidence = "pii_full" | "pii_name" | "slug";

interface NormalizedCandidate {
  vendor: Vendor;
  app_id: string;
  fi_id: string;
  fi_name: string;
  fi_slug: string;
  is_demo: boolean;
  first_name: string | null;
  last_name: string | null;
  dob: string | null;
  applicant_key: string;
  key_confidence: KeyConfidence;
  created_at: string;
  // Whether this candidate represents a billable vendor call on its own.
  eligible: boolean;
  // Effectiv-only: reached the vendor's fraud step.
  reached_fraud_step: boolean | null;
}

export interface FiSummary {
  fi_id: string;
  fi_name: string;
  fi_slug: string;
  is_demo: boolean;
  // Billable: distinct applicants (in non-demo FIs) with >=1 eligible vendor call.
  billable_inquiries: number;
  effectiv_only: number;
  plaid_only: number;
  both: number;
  // Cost-side raw vendor call counts (what the vendors invoice us for).
  effectiv_calls: number;
  plaid_calls: number;
  // Non-billable buckets.
  non_billable_failed: number; // Effectiv rows that never reached the fraud step
  non_billable_duplicate: number; // redundant vendor calls for the same person+vendor
  non_billable_internal: number; // would-be-billable inquiries on demo/test FIs
  // Audit signals.
  ambiguous_slug_only: number; // inquiries keyed by slug fallback (no PII)
  potential_cross_vendor_dupes: number; // same dob+lastName, different firstName across vendors
}

export interface DetailRow {
  fi_name: string;
  fi_slug: string;
  app_id: string;
  applicant_key: string;
  key_confidence: KeyConfidence;
  applicant_label: string; // redacted: first initial + last name
  dob_year_month: string | null; // YYYY-MM (no day, for light PII reduction)
  effectiv: boolean;
  plaid: boolean;
  classification: "billable" | "non_billable_internal" | "ambiguous";
}

export interface FgpUtilizationResult {
  summary_by_fi: FiSummary[];
  totals: {
    fi_count: number;
    billable_inquiries: number;
    effectiv_only: number;
    plaid_only: number;
    both: number;
    effectiv_calls: number;
    plaid_calls: number;
    non_billable_failed: number;
    non_billable_duplicate: number;
    non_billable_internal: number;
    ambiguous_slug_only: number;
    potential_cross_vendor_dupes: number;
  };
  detail?: DetailRow[];
  detail_truncated?: boolean;
}

const DETAIL_CAP = 5000;

function normName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

// First whitespace-delimited token of a (normalized) first name. Effectiv stores
// the typed first name ("alexander") while Plaid extracts the full legal name
// from the government ID ("alexander gregory"); matching on the first token
// reconciles these for the same person without merging genuinely different first
// names. Validated on the April window: 5,120 of 5,154 cross-vendor name
// mismatches (same dob + last name) share the first token.
function firstToken(s: string | null | undefined): string {
  const n = normName(s);
  const i = n.indexOf(" ");
  return i === -1 ? n : n.slice(0, i);
}

function normSlug(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().trim();
}

// Coerce a variety of date encodings to YYYY-MM-DD; null when unparseable.
function normDob(s: string | null | undefined): string | null {
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1]}-${us[2]}`;
  return null;
}

function deriveKey(
  first: string | null,
  last: string | null,
  dob: string | null,
  appId: string,
  slug: string | null
): { key: string; confidence: KeyConfidence } {
  const f = firstToken(first);
  const l = normName(last);
  const d = normDob(dob);
  if (f && l && d) return { key: `n:${f}|${l}|${d}`, confidence: "pii_full" };
  if (f && l) return { key: `n:${f}|${l}`, confidence: "pii_name" };
  return { key: `s:${appId}|${normSlug(slug)}`, confidence: "slug" };
}

function normalizeEffectiv(c: EffectivCandidate): NormalizedCandidate {
  const { key, confidence } = deriveKey(
    c.first_name,
    c.last_name,
    c.dob,
    c.app_id,
    c.slug
  );
  return {
    vendor: "effectiv",
    app_id: c.app_id,
    fi_id: c.fi_id,
    fi_name: c.fi_name,
    fi_slug: c.fi_slug,
    is_demo: c.is_demo,
    first_name: c.first_name,
    last_name: c.last_name,
    dob: normDob(c.dob),
    applicant_key: key,
    key_confidence: confidence,
    created_at: c.created_at,
    eligible: c.reached_fraud_step === true,
    reached_fraud_step: c.reached_fraud_step,
  };
}

function normalizePlaid(c: PlaidCandidate): NormalizedCandidate {
  const { key, confidence } = deriveKey(
    c.first_name,
    c.last_name,
    c.dob,
    c.app_id,
    c.slug
  );
  return {
    vendor: "plaid",
    app_id: c.app_id,
    fi_id: c.fi_id,
    fi_name: c.fi_name,
    fi_slug: c.fi_slug,
    is_demo: c.is_demo,
    first_name: c.first_name,
    last_name: c.last_name,
    dob: normDob(c.dob),
    applicant_key: key,
    // A Plaid session always represents a vendor charge (success and failed are
    // both billed by Plaid; abandoned initiations likewise once captured).
    eligible: true,
    key_confidence: confidence,
    created_at: c.created_at,
    reached_fraud_step: null,
  };
}

interface Inquiry {
  fi_id: string;
  fi_name: string;
  fi_slug: string;
  is_demo: boolean;
  app_id: string;
  applicant_key: string;
  key_confidence: KeyConfidence;
  vendors: Set<Vendor>;
  first_name: string | null;
  last_name: string | null;
  dob: string | null;
}

export function computeFgpUtilization(
  effectiv: EffectivCandidate[],
  plaid: PlaidCandidate[],
  opts: { includeDetail?: boolean } = {}
): FgpUtilizationResult {
  const candidates: NormalizedCandidate[] = [
    ...effectiv.map(normalizeEffectiv),
    ...plaid.map(normalizePlaid),
  ];

  // Per-FI running tallies for the non-inquiry-level buckets.
  const fiMeta = new Map<
    string,
    { fi_name: string; fi_slug: string; is_demo: boolean }
  >();
  const effectivCalls = new Map<string, number>();
  const plaidCalls = new Map<string, number>();
  const failedEffectiv = new Map<string, number>();

  // Distinct (inquiry, vendor) pairs — anything beyond the first eligible call
  // for the same person+vendor is a redundant (duplicate) vendor charge.
  const seenInquiryVendor = new Set<string>();
  const duplicateCalls = new Map<string, number>();

  const inquiries = new Map<string, Inquiry>();

  for (const c of candidates) {
    if (!fiMeta.has(c.fi_id)) {
      fiMeta.set(c.fi_id, {
        fi_name: c.fi_name,
        fi_slug: c.fi_slug,
        is_demo: c.is_demo,
      });
    }

    if (c.vendor === "effectiv") {
      if (c.eligible) {
        effectivCalls.set(c.fi_id, (effectivCalls.get(c.fi_id) ?? 0) + 1);
      } else {
        failedEffectiv.set(c.fi_id, (failedEffectiv.get(c.fi_id) ?? 0) + 1);
      }
    } else {
      plaidCalls.set(c.fi_id, (plaidCalls.get(c.fi_id) ?? 0) + 1);
    }

    if (!c.eligible) continue;

    const inquiryKey = `${c.app_id}::${c.applicant_key}`;
    const ivKey = `${inquiryKey}::${c.vendor}`;
    if (seenInquiryVendor.has(ivKey)) {
      duplicateCalls.set(c.fi_id, (duplicateCalls.get(c.fi_id) ?? 0) + 1);
    } else {
      seenInquiryVendor.add(ivKey);
    }

    let inq = inquiries.get(inquiryKey);
    if (!inq) {
      inq = {
        fi_id: c.fi_id,
        fi_name: c.fi_name,
        fi_slug: c.fi_slug,
        is_demo: c.is_demo,
        app_id: c.app_id,
        applicant_key: c.applicant_key,
        key_confidence: c.key_confidence,
        vendors: new Set(),
        first_name: c.first_name,
        last_name: c.last_name,
        dob: c.dob,
      };
      inquiries.set(inquiryKey, inq);
    }
    inq.vendors.add(c.vendor);
    // Prefer the strongest key confidence we have seen for this person.
    if (
      c.key_confidence === "pii_full" ||
      (c.key_confidence === "pii_name" && inq.key_confidence === "slug")
    ) {
      inq.key_confidence = c.key_confidence;
    }
  }

  // Cross-vendor near-match diagnostic: within an app, an Effectiv and a Plaid
  // inquiry that share dob + last name but differ on first name are likely the
  // same person counted twice (name typed vs. name on the government ID).
  const potentialDupes = new Map<string, number>();
  const byApp = new Map<string, Inquiry[]>();
  for (const inq of inquiries.values()) {
    const list = byApp.get(inq.app_id) ?? [];
    list.push(inq);
    byApp.set(inq.app_id, list);
  }
  for (const list of byApp.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.applicant_key === b.applicant_key) continue;
        const aLast = normName(a.last_name);
        const bLast = normName(b.last_name);
        const aFirst = firstToken(a.first_name);
        const bFirst = firstToken(b.first_name);
        if (
          a.dob &&
          a.dob === b.dob &&
          aLast &&
          aLast === bLast &&
          aFirst !== bFirst
        ) {
          potentialDupes.set(a.fi_id, (potentialDupes.get(a.fi_id) ?? 0) + 1);
        }
      }
    }
  }

  // Roll inquiries up per FI.
  const fiAgg = new Map<string, FiSummary>();
  const ensure = (fiId: string): FiSummary => {
    let s = fiAgg.get(fiId);
    if (!s) {
      const meta = fiMeta.get(fiId)!;
      s = {
        fi_id: fiId,
        fi_name: meta.fi_name,
        fi_slug: meta.fi_slug,
        is_demo: meta.is_demo,
        billable_inquiries: 0,
        effectiv_only: 0,
        plaid_only: 0,
        both: 0,
        effectiv_calls: effectivCalls.get(fiId) ?? 0,
        plaid_calls: plaidCalls.get(fiId) ?? 0,
        non_billable_failed: failedEffectiv.get(fiId) ?? 0,
        non_billable_duplicate: duplicateCalls.get(fiId) ?? 0,
        non_billable_internal: 0,
        ambiguous_slug_only: 0,
        potential_cross_vendor_dupes: potentialDupes.get(fiId) ?? 0,
      };
      fiAgg.set(fiId, s);
    }
    return s;
  };
  // Make sure every FI that produced any candidate appears, even with 0 billable.
  for (const fiId of fiMeta.keys()) ensure(fiId);

  for (const inq of inquiries.values()) {
    const s = ensure(inq.fi_id);
    const hasE = inq.vendors.has("effectiv");
    const hasP = inq.vendors.has("plaid");
    if (inq.is_demo) {
      s.non_billable_internal += 1;
      continue;
    }
    s.billable_inquiries += 1;
    if (hasE && hasP) s.both += 1;
    else if (hasE) s.effectiv_only += 1;
    else s.plaid_only += 1;
    if (inq.key_confidence === "slug") s.ambiguous_slug_only += 1;
  }

  const summary_by_fi = [...fiAgg.values()].sort((a, b) =>
    a.fi_name.localeCompare(b.fi_name)
  );

  const totals = summary_by_fi.reduce(
    (t, s) => {
      t.billable_inquiries += s.billable_inquiries;
      t.effectiv_only += s.effectiv_only;
      t.plaid_only += s.plaid_only;
      t.both += s.both;
      t.effectiv_calls += s.effectiv_calls;
      t.plaid_calls += s.plaid_calls;
      t.non_billable_failed += s.non_billable_failed;
      t.non_billable_duplicate += s.non_billable_duplicate;
      t.non_billable_internal += s.non_billable_internal;
      t.ambiguous_slug_only += s.ambiguous_slug_only;
      t.potential_cross_vendor_dupes += s.potential_cross_vendor_dupes;
      return t;
    },
    {
      fi_count: summary_by_fi.length,
      billable_inquiries: 0,
      effectiv_only: 0,
      plaid_only: 0,
      both: 0,
      effectiv_calls: 0,
      plaid_calls: 0,
      non_billable_failed: 0,
      non_billable_duplicate: 0,
      non_billable_internal: 0,
      ambiguous_slug_only: 0,
      potential_cross_vendor_dupes: 0,
    }
  );

  const result: FgpUtilizationResult = { summary_by_fi, totals };

  if (opts.includeDetail) {
    const detail: DetailRow[] = [];
    let truncated = false;
    for (const inq of inquiries.values()) {
      if (detail.length >= DETAIL_CAP) {
        truncated = true;
        break;
      }
      const first = (inq.first_name ?? "").trim();
      const last = (inq.last_name ?? "").trim();
      const initial = first ? `${first[0].toUpperCase()}.` : "";
      detail.push({
        fi_name: inq.fi_name,
        fi_slug: inq.fi_slug,
        app_id: inq.app_id,
        applicant_key: inq.applicant_key,
        key_confidence: inq.key_confidence,
        applicant_label: `${initial} ${last}`.trim() || "(unknown)",
        dob_year_month: inq.dob ? inq.dob.slice(0, 7) : null,
        effectiv: inq.vendors.has("effectiv"),
        plaid: inq.vendors.has("plaid"),
        classification: inq.is_demo
          ? "non_billable_internal"
          : inq.key_confidence === "slug"
            ? "ambiguous"
            : "billable",
      });
    }
    result.detail = detail.sort(
      (a, b) =>
        a.fi_name.localeCompare(b.fi_name) || a.app_id.localeCompare(b.app_id)
    );
    result.detail_truncated = truncated;
  }

  return result;
}
