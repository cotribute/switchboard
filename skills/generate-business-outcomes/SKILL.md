---
name: generate-business-outcomes
description: Generate a polished markdown business-outcomes executive document for one Cotribute financial-institution customer. Resolves the FI, runs the standard 10-query data battery via the `db_business_outcomes_battery` MCP tool against the production replica, classifies product mix, picks one of three narrative templates (multi-product, account-opening-focused, lending-only), and synthesizes the document. Use when a CSM, AM, or executive asks for a business-review doc, outcomes summary, or executive recap for a credit union or other financial-institution customer of Cotribute — examples of triggers: "Generate business outcomes for Fort Financial", "Build an exec summary for Valley CU", "Outcomes doc for Members' Advantage".
---

# Generate Business Outcomes (Cowork)

This is the **Claude Cowork** edition of the business-outcomes generator. It mirrors the Claude Code skill at `dreambigger/.claude/agents/generate-business-outcomes.md` — same SQL, same templates, same terminology — but data access goes through one MCP call instead of `yarn db:replica`, and output is markdown only (no PPTX).

Output format mirrors the seven manually-produced reference docs (Leading Edge, Nutmeg, Capitol, Center Parc, Valley, Fort Financial, Members' Advantage).

## Inputs

1. **FI identifier** (required) — name fragment, slug, or UUID. Examples: `Valley`, `fort-financial-cu`, `Members' Advantage`, `1588cdcc-8ec9-4c50-ac5d-ddfaf99f73d9`.
2. **Reporting end date** (optional, `YYYY-MM-DD`) — defaults to today. Bounds the risk-signal cohort.

## Execution model

**Fully autonomous** once the FI is unambiguously resolved. No template-confirmation prompt, no step-through. Render the markdown directly in the chat.

Exception: if the FI identifier resolves to multiple matches, list candidates and ask which one before proceeding.

## Step 1 — Fetch the data battery

Call the MCP tool exactly once:

```
db_business_outcomes_battery({
  fi_query: "<FI identifier>",
  end_date: "<YYYY-MM-DD optional>"
})
```

This runs the full 10-query battery against the production replica and returns a single JSON payload with everything the skill needs. The tool encapsulates the non-obvious join paths (FIS GKYC via the configurations table, risk-signal cohort filtering, etc.) — the skill never has to think about SQL.

Three possible response shapes:

- `{ ok: false, error: "..." }` — stop and surface the error to the user.
- `{ ambiguous: true, candidates: [{id, name, slug}, ...] }` — list the candidates and ask the user to pick one, then re-call with the chosen `id` as `fi_query`.
- `{ ok: true, fi: {...}, product_overview: [...], ... }` — proceed to Step 2.

The successful payload contains:

| Field | Type | Source |
| :---- | :--- | :----- |
| `fi` | `{id, name, slug, brand: {primary_color, secondary_color, primary_logo}}` | financial_institutions row |
| `end_date` | `YYYY-MM-DD` | echoed |
| `product_overview` | rows: `{product_slug, active_flows, total_apps, complete, submitted, pending_submit, draft, canceled, failed, first_app, last_app}` | per-product status mix + activity window |
| `decision_distribution` | rows: `{product, title, decision, apps}` | reason-code rollup, keyed by product |
| `flow_breakdown` | rows: `{product, title, apps, decisioned, approved, denied, drafts, pending}` | per-flow performance |
| `risk_signals` | `{fg_checks, fg_decline, fg_review, fg_approve, idv_attempts, idv_clean, chex_checks, gkyc_checks, gkyc_fail, gkyc_pass, gkyc_review}` | Fraud Guard+, Cotribute IDV, Corelation Chex, FIS GKYC |
| `ofac` | `{orders, apps_checked, hits}` | watchlist totals |
| `decision_automation` | rows: `{product, apps, total_transitions, rule_transitions, admin_transitions}` | rule vs. admin transitions |
| `time_to_decision` | rows: `{product, approved, denied, median_min_to_approve, median_min_to_deny}` | median time-to-terminal-decision |
| `unique_users` | `{unique_users, total_apps, first_app, last_app}` | top-of-funnel identity capture |
| `monthly_trend` | rows: `{month, submitted, approved, denied, review}` | monthly funnel mix |
| `loan_dollars` | rows: `{slug, apps, apps_w_amount, total_demand, avg_loan, approved_dollars, denied_dollars}` | per-product loan economics (best-effort) |

## Step 2 — Classify product mix

Inspect `product_overview` slugs:

- **Account-opening:** slug matches `*account-opening*`, `*-cao*`, `*-bao*`, `*youth*`, `*share*`, `*subshare*`, `*idg*`, `*-te*`, `*fiduciary*`, `*estate*`, `*trust*`
- **Lending:** slug matches `*loan*`, `*-cla*`, `*credit-card*`, `*heloc*`, `*home-equity*`, `*mortgage*`
- **Service (ignored for templating):** slug matches `*ddswitch*`, `*direct-deposit*`, `*lookup*`, `*atomic*`

Decide template:

- **Multi-product** — ≥1 active AO product AND ≥1 active lending product, each with `total_apps > 50`.
- **AO-focused** — only AO products active, OR lending side is sunset (`MAX(last_app on lending products) < end_date - 90 days`). When lending is sunset, end the doc with an **"Appendix — Note on Loans"** section summarising what was captured during the active window.
- **Lending-only** — only lending products active.

## Step 3 — Brief pre-flight (informational)

Print one concise message to the chat so the user sees what's about to happen — no prompt, just proceed:

```
RESOLVED: <fi.name> (<fi.slug>)
Reporting period: <unique_users.first_app> – <end_date> (~<N> months)
Product mix: <slug list with app counts>
Detected template: <multi-product | ao-focused | lending-only>
Headline:
  - <total_apps> total applications
  - <unique_users.unique_users> unique financial-user identities
  - <approved> auto-approved
  - <median_min_to_approve> min median time-to-approval (consumer accounts)
Generating markdown...
```

## Step 4 — Synthesise markdown

Render the appropriate template — A (multi-product), B (AO-focused), C (lending-only) — see **Templates** section below.

### Universal rules — DO NOT VIOLATE

- Always use **Cotribute IDV** (never "Plaid IDV"). Always use **Fraud Guard+** (never "Effectiv FraudGuard", "Socure", "IPQS"). Use **FIS GKYC** by its proper name (some legacy reference docs called this "BizChex" or "ChexSystems" — those are wrong; correct them).
- **Never mention Clearwater** under any circumstances (also a Cotribute client).
- Never use internal Cotribute artifact names: `field_mappings`, `JSONata`, `core_banking_configurations`, `flow configuration`, `financial-application template`.
- Never use core-internal data-model names: `type serial`, `person object`, `tin/tinType`. Use plain-English equivalents — "account type", "applicant added", "tax ID".
- Reason codes in denial tables are pulled **verbatim** from `decision_distribution[].title`.
- Monthly trend formatted as a code block with 3 or 4 columns depending on data density.
- Reporting period format: `<Month D, YYYY> – <Month D, YYYY> (~N months in production)`.

### Scoping rules (validated against 7 reference FIs)

These resolve ambiguities surfaced during validation testing:

- **Denial tables are scoped by section.** Section 1 (Membership / Account Growth) renders denial reasons from AO products only. Section 2 (Loan Volume) renders denial reasons from lending products only. Don't mix product families in a single denial table — that inflates "Denied — Loans Only" rows and "Withdrawn" counts.
- **Risk-signal table is adaptive — omit rows for unused checks.** When an FI doesn't run a check (e.g., Capitol has no Corelation Chex; Nutmeg has no FIS GKYC; MACU has no risk stack), skip the row entirely rather than rendering "0". The table shape adapts to the FI's actual risk stack.
- **Loan-dollar narrative is skipped entirely when data is empty.** If every `loan_dollars[].apps_w_amount` is 0 (the FI doesn't populate `financial_applications.loan_amount`), do NOT write a "$0 demand" line. Note once in commentary that loan dollars aren't tracked for this FI's product configuration, then move on.
- **Drift vs reference is expected.** Fresh runs accumulate ~10–200 additional applications vs the reference docs since the replica keeps growing. Don't try to match reference numbers exactly — drifts of ±0.5–2% are normal and confirm the data battery is working correctly.

## Step 5 — Recommendations

Generate 3–5 bullets matched to the data, drawing from these patterns:

| Trigger | Recommendation pattern |
| :--- | :--- |
| `draft_count / total_apps > 0.30` | Deploy abandoned-application nurture. With {{draft_count}} drafts on file, an automated re-engagement sequence (email + SMS) is the highest-ROI growth lever available with no platform changes. |
| `fg_checks == 0 AND idv_attempts == 0` | Activate Fraud Guard+ and Cotribute IDV. The platform's productized risk stack would surface fraud-driven denials at the front door and accelerate clean-applicant decisioning. |
| `rule_transitions == 0 AND admin_transitions > 50` | Move decisioning from manual to rules-driven. Comparable deployments run 78–85% rules-driven, freeing the underwriting team for edge cases. |
| `has_ao AND NOT has_bao` | Expand into business account opening. The platform's same infrastructure supports BAO with minimal additional configuration. |
| `has_loans AND NOT has_ao` | Expand into account opening. The platform currently runs lending-only; adding a consumer AO flow completes the member-acquisition motion. |
| `any flow with approval_rate < 0.30` | Diagnose the {{flow_name}} funnel. A {{approval_rate}}% approval rate suggests a fixable gap in pre-qualification or document collection. |
| `lowest_volume_product with apps < 20 AND has_pattern` | Promote / productize the {{product_name}} segment. Only {{apps}} applications in {{N}} months despite a clean approval pattern. |

## Step 6 — Deliver to user

Render the markdown directly in the Cowork chat (no filesystem writes — Cowork has none). After the doc, print one final summary line:

```
✓ Business outcomes generated for <fi.name>
  Template: <multi-product | ao-focused | lending-only>
  Period: <first_app> – <end_date> (~<N> months)
  Headline: <X> applications · <Y> approvals · <Z>% automation
```

## Edge cases

- **FI with no production applications** — stop after Step 1 with a note: "FI is configured but has no application data on the replica."
- **FI with active and sunset products** — only count products with `MAX(last_app) > end_date - 90 days` as active. Sunset products go in an "Appendix — Note on Loans" (or equivalent) at the bottom.
- **Brand config missing** — fall back to noting "brand not configured" in the pre-flight summary. No knock-on effect on the markdown.
- **Time-to-decision is an outlier** — if median > 30 days, the data likely contains stale `decision_status_logs` from a prior FI lifecycle. Report it but flag the value as "may include legacy data" in the markdown commentary.

## Templates

### Template A — Multi-product

```markdown
# {{fi_name}} — Business Outcomes with Cotribute

**Reporting period:** {{first_app_long}} – {{reporting_end_long}} (~{{months}} months in production)
**Prepared for:** {{fi_name}} executive team

---

## Executive Summary

{{fi_name}} has used Cotribute since {{first_app_month_year}} as the digital front door for {{product_summary_clause}}. In ~{{months}} months the platform has:

- Processed **{{total_apps}} onboarding applications** across {{product_count}} product lines and {{flow_count}} distinct flows.
- Auto-approved **{{total_approved}} net-new accounts** ({{ao_approved}} consumer + {{bao_approved}} business{{+youth if applicable}}) end-to-end.
- Captured **{{unique_users}} unique financial-user identities** at the top of funnel.
- {{ if loan_dollars }} Decisioned **${{loan_dollars_total}} of consumer loan demand** with **${{loan_dollars_approved}} auto-approved**. {{ else }} Routed **{{loan_apps_to_los}} consumer loan applications** to the LOS, pre-screened with full fraud, identity, and decisioning context. {{ end }}
- Achieved a **median time-to-approval of {{ttd_minutes}} minutes** on consumer accounts.
- Hit **{{automation_pct}}% decision automation** on consumer accounts ({{rule_transitions}} rule-driven vs {{admin_transitions}} admin-driven).
- Ran **{{total_risk_checks}} independent risk checks** across {{adaptive_risk_clause}}, declining **{{fg_decline}} applications at the fraud layer alone** before they reached decisioning.

---

## 1. Membership & New Account Growth

{{ if has_branch_vs_self_service }}The credit union runs in-branch and self-service variants of every consumer product, sharing the same decisioning, fraud, and core-banking integration.{{ end }}

| Metric                                   | Consumer Account Opening  | Business Account Opening  |
| :--------------------------------------- | :------------------------ | :------------------------ |
| Applications submitted                   | {{cao_submitted}}         | {{bao_submitted}}         |
| Applications decisioned                  | {{cao_decisioned}}        | {{bao_decisioned}}        |
| **Auto-approved**                        | **{{cao_approved}}**      | **{{bao_approved}}**      |
| Auto-denied                              | {{cao_denied}}            | {{bao_denied}}            |
| Routed to manual review                  | {{cao_review}}            | {{bao_review}}            |
| **Approval rate** (of approved + denied) | **{{cao_approval_pct}}%** | **{{bao_approval_pct}}%** |

{{ if per_flow_split }}
### {{flow_section_title}}
| Flow | Decisioned | Approved | Denied | Approval rate |
| :--- | :--------- | :------- | :----- | :------------ |
{{ each per_flow_row }}
{{ end }}

### Auto-denials with reason codes — AO products only

| Reason | Count |
| :----- | :---- |
{{ each ao_denial_reason_row }}

### Monthly trend — {{trend_subject}}

{{ monthly_trend_code_block }}

---

## 2. Loan Volume & Origination

{{ describe_loan_setup_paragraph }}

| Loan product | Apps decisioned | Routed to LOS | Auto-denied at front door |
| :----------- | :-------------- | :------------ | :------------------------ |
{{ each loan_product_row }}

### Auto-denials with reason codes — loan products only

| Reason | Count |
| :----- | :---- |
{{ each loan_denial_reason_row }}

{{ if has_loan_dollars }}
### Demand and approval economics
{{ loan_dollars_paragraph_or_table }}
{{ end }}

---

## 3. Fraud Prevention & Risk Containment

Cotribute layers productized risk signals on every {{fi_name}} application. Only signals this FI actually runs are shown — empty rows are omitted.

| Signal | Total checks | Decline / Fail | Review / Flag | Pass / Approve |
| :----- | :----------- | :------------- | :------------ | :------------- |
{{ each active_risk_signal_row }}

{{ denial_summary_paragraph }}

---

## 4. Automation & Operational Efficiency

| Product | Rule-driven transitions | Admin-driven transitions | % rule-driven |
| :------ | :---------------------- | :----------------------- | :------------ |
{{ each automation_row }}

### Time-to-decision (median, application start → terminal decision)

| Product | Approved | Denied |
| :------ | :------- | :----- |
{{ each ttd_row }}

{{ automation_commentary }}

---

## 5. Funnel Health & What's Next

Of the **{{total_apps}} applications started** across all products:

- **Decisioned and complete:** {{decisioned_count}} ({{decisioned_pct}}%)
- **Pending submit:** {{pending_count}}
- **Drafts / abandoned:** {{draft_count}} ({{draft_pct}}%)
- **Failed / canceled:** {{failed_count}}

### Recommendations

{{ generated_recommendations_bullets }}

---

_Generated from production telemetry. Numbers reflect activity through end-of-day {{reporting_end_long}}._
```

### Template B — AO-focused

Same as Template A but **omit Section 2 (Loan Volume)** entirely. If lending was previously active but now sunset, add an **"Appendix — Note on Loans"** section at the end summarising what was captured during the active window.

### Template C — Lending-only

```markdown
# {{fi_name}} — Business Outcomes with Cotribute

**Reporting period:** {{first_app_long}} – {{reporting_end_long}} (~{{months}} months in production)
**Prepared for:** {{fi_name}} executive team

---

## Executive Summary

{{fi_name}} launched on Cotribute in **{{first_app_month_year}}** with a focused consumer-lending deployment. In {{months}} months of production:

- Processed **{{total_apps}} consumer loan applications** across {{product_count}} product flows.
- Captured **{{unique_users}} unique financial-user identities** at the top of funnel.
- Decisioned **{{decisioned_count}} applications**, with **{{approved_count}} approved ({{approval_pct}}% approval rate)** and {{denied_count}} denied.
- {{growth_clause}}

---

## 1. Lending Volume by Product Line

| Loan product | Applications | Decisioned | **Approved** | Denied | Approval rate |
| :----------- | :----------- | :--------- | :----------- | :----- | :------------ |
{{ each loan_product_row }}

{{ per_product_commentary }}

---

## 2. Member Acquisition Trajectory

{{ monthly_trend_code_block }}

{{ run_rate_callout }}

---

## 3. Funnel Health & What's Next

Of the {{total_apps}} applications started:

- **Decisioned:** {{decisioned_count}} ({{decisioned_pct}}%)
- **Submitted, in review:** {{submitted_count}}
- **Drafts / abandoned:** {{draft_count}} ({{draft_pct}}%)

### Where the platform investment should go next

{{ generated_recommendations_bullets }}

---

## 4. The {{months}}-Month Baseline

The numbers above are the baseline against which the next twelve months of platform investment should be measured.

---

_Generated from production telemetry. Numbers reflect activity through end-of-day {{reporting_end_long}}._
```

## Reference outputs

Output should be structurally equivalent to the seven manually-produced reference docs in `~/Downloads/business-outcomes/` on the dreambigger maintainer's machine. When in doubt about prose phrasing, mirror those docs' tone — operator-friendly, data-forward, no vendor pitch.

## Out of scope (v1)

- **PPTX deck.** Cowork has no local Python runtime. A follow-up may add a `pptxgenjs`-based switchboard tool that returns a presigned S3 URL.
- **Diff mode** for re-runs. v1 just regenerates.
- **Case-study output mode** (Story Brand framing for specific FIs). Out of scope — that remains bespoke.
