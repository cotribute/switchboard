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

| Field                                   | Meaning                                                                                              |
| :-------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| `fi_name`, `fi_slug`, `is_demo`         | FI identity; `is_demo` = excluded from billable (test/demo org).                                     |
| `billable_inquiries`                    | **The invoice number** — distinct billable applicants (Effectiv and/or Plaid).                       |
| `effectiv_only` / `plaid_only` / `both` | Breakdown of billable inquiries by vendor mix.                                                       |
| `effectiv_calls` / `plaid_calls`        | Raw vendor charge counts (cost side).                                                                |
| `non_billable_failed`                   | Effectiv calls that never reached the fraud step (not billed to client).                             |
| `non_billable_duplicate`                | Redundant retries for the same person+vendor (extra vendor cost, not separately billable).           |
| `non_billable_internal`                 | Would-be-billable inquiries on demo/test FIs.                                                        |
| `ambiguous_slug_only`                   | Inquiries attributed by slug fallback (no PII) — audit.                                              |
| `potential_cross_vendor_dupes`          | Same dob+last name, different first name across vendors — possible same person counted twice; audit. |

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

1. **Fraud Inquiry Costs** (primary — matches the existing FGP monthly invoice sheet). One row per FI, sorted alphabetically. Columns in this exact order:

   | Group     | Columns                                                                                                                                                                                                                                                                                                                 |
   | :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | **A**     | `Client` (= `fi_name`)                                                                                                                                                                                                                                                                                                  |
   | **B–C**   | `FGP Qty` (= `billable_inquiries`), `Delta` (= `billable_inquiries − plaid_base`)                                                                                                                                                                                                                                       |
   | **D–E**   | `IDV Qty` (= `plaid_base`), `IDV Cost` (= `plaid_base × $0.40` — legacy column, kept for parity)                                                                                                                                                                                                                        |
   | **F–S**   | 7 Socure modules. Each has a Qty + Cost pair. **Qty for every module = `effectiv_calls`** (each Effectiv eval triggers all 7 modules). Cost = Qty × per-module unit price from `pricing.socure`: M01-EML (.0317), M02-PHO (.0317), M03-ADR (.0277), M04-FRA (.1584), M05-KYC (.1584), M06-WL1 (.0396), M17-SYN (.0554). |
   | **T**     | `Socure Subtotal $` (= `costs.socure_subtotal`)                                                                                                                                                                                                                                                                         |
   | **U–V**   | `IV-Base Qty` (= `plaid_base`), `IV-Base Cost` (= `costs.plaid_base_cost`)                                                                                                                                                                                                                                              |
   | **W–X**   | `IV-Doc Qty` (= `plaid_doc`), `IV-Doc Cost` (= `costs.plaid_doc_cost`)                                                                                                                                                                                                                                                  |
   | **Y–Z**   | `IV-Selfie Qty` (= `plaid_selfie`), `IV-Selfie Cost` (= `costs.plaid_selfie_cost`)                                                                                                                                                                                                                                      |
   | **AA–AB** | `IV-Lightning Qty` (= `plaid_lightning`), `IV-Lightning Cost` (= `costs.plaid_lightning_cost`)                                                                                                                                                                                                                          |
   | **AC**    | `Plaid Subtotal $` (= `costs.plaid_subtotal`)                                                                                                                                                                                                                                                                           |
   | **AD**    | `Grand Total $` (= `costs.grand_total`)                                                                                                                                                                                                                                                                                 |

   Bold header row, freeze panes at column B / row 2, currency formatting (`$#,##0.00`) on every Cost column, header with two sub-rows showing the unit price under each column header (replicate the source sheet's header layout: row 1 vendor group label, row 2 line-item, row 3 "Qty" / "Cost ($X)" with the price). Append a bold **TOTAL (Our Clients)** row summing all columns from `totals.costs`. Demo FIs (`is_demo: true`) go at the bottom with name suffixed " (DEMO — excluded)" and totals row should EXCLUDE them.

2. **Summary** (legacy compact view — keep for analyst use). One row per FI: `FI`, `Billable Inquiries`, `Effectiv Only`, `Plaid Only`, `Both`, `Effectiv Calls`, `Plaid Calls`, `Plaid Base`, `Plaid Doc`, `Plaid Selfie`, `Plaid Lightning`, `Non-Billable: Failed`, `Non-Billable: Duplicate`, `Non-Billable: Internal`, `Ambiguous (slug-only)`. Append TOTAL row from `totals`.

3. **Methodology** — a text tab so finance can audit. Include verbatim:
   - The billing rule (per applicant; Effectiv and/or Plaid = 1 inquiry; joint applicants separate).
   - The `notes` array returned by the tool.
   - Person-match rule: normalized first-name token + last name + DOB; SSN/slug are fallbacks.
   - Pricing block from `pricing` (so finance sees the unit rates the workbook used).
   - Lightning template detection rule (a template is Lightning if any of its sessions has `raw->kyc_check` as a jsonb object — validated to recover ~98% of Plaid's invoice IV-Lightning count). The current `lightning_template_ids` count comes back in the response and should be noted.
   - **Known limitation on IV-Doc** (~+9% over invoice): we count any session where the document step ran (incl. `active`/in-progress uploads). Plaid bills on a tighter ledger event we cannot observe. Per-FI variance is small; the dollar impact at total level is ~2% of the Plaid line.

4. **Detail** (optional, single-FI `include_detail` run) — one row per billable/ambiguous applicant: `FI`, `Application ID`, `Applicant` (redacted: initial + last name), `DOB (YYYY-MM)`, `Effectiv`, `Plaid`, `Classification`, `Key Confidence`. If `detail_truncated` is true, add a note row.

## Step 4 — Deliver

1. Present the file via `mcp__cowork__present_files` and include a `computer://` link as the final line of the response.
2. Print one summary line:
   ```
   ✓ FGP utilization generated — <start_date> → <end_date>
     <fi_count> FIs · <billable_inquiries> billable inquiries
     Cost side: <effectiv_calls> Effectiv + <plaid_calls> Plaid calls · <non_billable_duplicate> duplicate (retry) calls
   ```

## Reconciliation & caveats

- **Effectiv counts are exact.** `effectiv_calls` reproduces the legacy monthly Effectiv query (validated against the April + March invoice numbers FI-by-FI).
- **Plaid line items reconcile against the invoice** within these bounds on the validated March 2026 window:
  - IV-Base: +0.04% (timing residual on incomplete sessions).
  - IV-Selfie: −0.18%.
  - IV-Lightning: −2.05% (the ~200-session shortfall is mostly hard-deleted applications whose sessions Plaid retained but our DB lost).
  - IV-Document: +9.15% (over). We count `active` upload-in-progress sessions; Plaid bills on a tighter ledger event. Per-FI variance is small; total dollar impact ~$590 on a $26K invoice (~2%).
- **Plaid history pre-sessions-table:** if `sessions_available: false` the tool falls back to completed documents only and will UNDERCOUNT abandoned/Lightning sessions. Call that out in chat.
- **Demo/test FIs** are bucketed `non_billable_internal`, never billable.

## Out of scope

- Other vendors (FIS GKYC, Corelation ChexSystems) — separate cost lines.
- Emailing/sending the workbook — deliver the file; the user forwards it.
- Editing the database — this skill is read-only.
