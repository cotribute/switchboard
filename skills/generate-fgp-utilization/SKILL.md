---
name: generate-fgp-utilization
description: Generate a FraudGuard+ (FGP / "BG") utilization report for a date window — billable vs non-billable fraud/IDV inquiries per Cotribute financial institution. Runs the `db_fgp_utilization_battery` MCP tool against the production replica, which dedupes Effectiv (Fraud Guard+) and Plaid IDV calls per applicant (one person's Effectiv + Plaid = ONE inquiry; joint applicants are separate), classifies each as billable or non-billable, and returns per-FI counts plus raw vendor-cost counts. Delivers an Excel workbook (.xlsx) the finance team uses to generate monthly FGP invoices and protect margins. Use when finance, the CFO, or an operator asks for FraudGuard+ / FGP / fraud-guard utilization, billable inquiries, an FGP invoice run, or a monthly/weekly fraud-and-IDV usage report. Triggers: "FGP utilization for April", "how many billable fraud guard inquiries last month", "fraud guard invoice numbers", "Plaid IDV + Effectiv usage by credit union".
---

# Generate FraudGuard+ Utilization (Cowork)

Produces the monthly/weekly **FraudGuard+ utilization** workbook finance uses to invoice clients and reconcile vendor costs. Mirrors the structure of the `generate-business-outcomes` skill: data access is one MCP call, the deliverable is a file written to the user's workspace folder.

## What FGP billing means (read first)

- Cotribute bills clients **per applicant, per inquiry**. For one person, running Effectiv (Fraud Guard+) **and/or** Plaid IDV counts as **ONE** billable inquiry.
- **Joint applicants and beneficial owners are separate inquiries** on the same application.
- Our cost is vendor-side: Effectiv bills per evaluation, Plaid bills per IDV session. The gap between what we bill clients (revenue) and what vendors bill us (cost) is the margin the CFO cares about — the report surfaces both.

The MCP tool does all the per-applicant dedup and classification. The skill's job is to call it and format the result.

**Validated rules baked into the tool** (reconciled to the Plaid invoice within ~0.04% on a sample FI):
- **Plaid billable session = a verification step ran** (data-source/KYC **or** document **or** selfie). That's what triggers Plaid's IV-Base charge. Sessions created but abandoned before any check are not billable. Counted on a **UTC** calendar month (Plaid's billing boundary).
- **Per-applicant dedup** uses normalized first-name-token + last name + DOB (Plaid has no SSN; the `govt-id` slug is a template type, not a person). Cross-vendor match validated ~99%.
- **FGP counts Plaid-only applicants** (Plaid ran, Effectiv didn't) — the legacy hand-built sheets omitted these, so expect **higher** FGP totals than prior spreadsheets (this is the under-billing the CFO flagged, not an error).
- **Effectiv reflects the DB env**: the replica is prod, so Effectiv figures are prod-only and exclude UAT (legacy sheets' "Socure" column = prod + UAT).

## Inputs

1. **start_date** (required, `YYYY-MM-DD`, inclusive) — window start.
2. **end_date** (required, `YYYY-MM-DD`, exclusive) — window end.
3. **fi_query** (optional) — name fragment, slug, or UUID to scope to one FI. Omit for the all-FI monthly invoice run.

Defaults when the user gives a loose request (e.g. "FGP for April"): resolve to the named calendar month, `start_date` = first of month, `end_date` = first of the **next** month. If the user just says "last month", compute the previous calendar month relative to today.

## Execution model

Fully autonomous once the window is resolved. One MCP call → format → deliver. Do not paste the full per-FI table into chat as prose; the workbook is the deliverable.

## Step 1 — Fetch the battery

Call once:

```
db_fgp_utilization_battery({
  start_date: "<YYYY-MM-DD>",
  end_date:   "<YYYY-MM-DD>",
  fi_query:   "<optional>",
  include_detail: <true only when fi_query is a single FI and the user wants applicant-level detail>
})
```

Response shapes:

- `{ ok: false, error }` — surface the error, stop.
- `{ ambiguous: true, candidates: [...] }` — list candidates, ask which FI, re-call with the chosen `id` as `fi_query`.
- `{ ok: true, window, fi_filter, sessions_available, notes, summary_by_fi, totals, detail?, detail_truncated? }` — proceed.

Each `summary_by_fi` row:

| Field | Meaning |
| :---- | :------ |
| `fi_name`, `fi_slug`, `is_demo` | FI identity; `is_demo` = excluded from billable (test/demo org). |
| `billable_inquiries` | **The invoice number** — distinct billable applicants (Effectiv and/or Plaid). |
| `effectiv_only` / `plaid_only` / `both` | Breakdown of billable inquiries by vendor mix. |
| `effectiv_calls` / `plaid_calls` | Raw vendor charge counts (cost side). |
| `non_billable_failed` | Effectiv calls that never reached the fraud step (not billed to client). |
| `non_billable_duplicate` | Redundant retries for the same person+vendor (extra vendor cost, not separately billable). |
| `non_billable_internal` | Would-be-billable inquiries on demo/test FIs. |
| `ambiguous_slug_only` | Inquiries attributed by slug fallback (no PII) — audit. |
| `potential_cross_vendor_dupes` | Same dob+last name, different first name across vendors — possible same person counted twice; audit. |

## Step 2 — Pre-flight summary (one line, then proceed)

```
FGP UTILIZATION — <start_date> → <end_date>
FIs: <fi_count>  |  Billable inquiries: <totals.billable_inquiries>
Vendor calls: <totals.effectiv_calls> Effectiv + <totals.plaid_calls> Plaid
Plaid abandoned/email sessions: <"included" if sessions_available else "NOT captured for this window — completed-doc counts only (may undercount vs Plaid dashboard)">
Generating workbook...
```

## Step 3 — Build the workbook

Filename: `fgp-utilization-{start_date}-to-{end_date}.xlsx` (append `-{fi_slug}` when scoped to one FI). Write to the user's workspace folder.

Build with Python `openpyxl` in the Cowork code environment. If `openpyxl` is unavailable, fall back to writing one CSV per tab and note the fallback in chat.

**Tabs:**

1. **Summary** — one row per FI, sorted by `fi_name`. Columns in this order:
   `FI`, `Billable Inquiries`, `Effectiv Only`, `Plaid Only`, `Both`, `Effectiv Calls`, `Plaid Calls`, `Non-Billable: Failed`, `Non-Billable: Duplicate`, `Non-Billable: Internal`, `Ambiguous (slug-only)`, `Potential Cross-Vendor Dupes`.
   Bold header row, freeze the header, autofit-ish column widths. Append a bold **TOTAL** row from `totals`.
   Put `is_demo` FIs at the bottom with their name suffixed " (DEMO — excluded)".

2. **Methodology** — a short text tab so finance can audit. Include verbatim:
   - The billing rule (per applicant; Effectiv and/or Plaid = 1 inquiry; joint applicants separate).
   - The `notes` array returned by the tool (especially the Plaid-abandoned-session caveat when `sessions_available` is false).
   - Person-match rule: normalized first-name token + last name + DOB; SSN/slug are fallbacks.

3. **Detail** (only when `detail` is present — single-FI `include_detail` run) — one row per billable/ambiguous applicant: `FI`, `Application ID`, `Applicant` (redacted: initial + last name), `DOB (YYYY-MM)`, `Effectiv`, `Plaid`, `Classification`, `Key Confidence`. If `detail_truncated` is true, add a note row.

## Step 4 — Deliver

1. Present the file via `mcp__cowork__present_files` and include a `computer://` link as the final line of the response.
2. Print one summary line:
   ```
   ✓ FGP utilization generated — <start_date> → <end_date>
     <fi_count> FIs · <billable_inquiries> billable inquiries
     Cost side: <effectiv_calls> Effectiv + <plaid_calls> Plaid calls · <non_billable_duplicate> duplicate (retry) calls
   ```

## Reconciliation & caveats

- **Effectiv counts are exact.** `effectiv_calls` reproduces the legacy monthly Effectiv query (validated against the April invoice numbers FI-by-FI).
- **Plaid history may undercount.** Until the `financial_plaid_idv_sessions` table is deployed and backfilled (`sessions_available: false`), historical Plaid counts come only from **completed** documents — abandoned/email-only sessions that Plaid still billed are not captured. Call this out in chat for any window where `sessions_available` is false, so finance knows the Plaid side is a floor, not the exact Plaid invoice.
- **Demo/test FIs** are bucketed `non_billable_internal`, never billable.

## Out of scope

- Other vendors (FIS GKYC, Corelation ChexSystems) — separate cost lines.
- Emailing/sending the workbook — deliver the file; the user forwards it.
- Editing the database — this skill is read-only.
