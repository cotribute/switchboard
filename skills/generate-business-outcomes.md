# Generate Business Outcomes (Cowork)

## Purpose

Generate a polished markdown business-outcomes deliverable for a financial-institution customer. This is the **Claude Cowork** counterpart to the `/generate-business-outcomes` skill in the dreambigger repo (which also produces a PowerPoint deck for local users). The Cowork edition produces markdown only — the user copies or downloads it directly from the chat.

The output mirrors the format established across seven manually-produced docs (Leading Edge, Nutmeg, Capitol, Center Parc, Valley, Fort Financial, Members' Advantage).

## Activation phrase

Say **"Generate business outcomes for &lt;FI&gt;"** or **"Build a business outcomes doc for &lt;FI&gt;"**.

## Required information

The skill will accept (or ask for) :

1. **FI identifier** — name fragment, slug, or UUID. Examples: `Valley`, `fort-financial-cu`, `Members' Advantage`, `1588cdcc-8ec9-4c50-ac5d-ddfaf99f73d9`.
2. **Reporting end date** (optional, `YYYY-MM-DD`) — defaults to today. Bounds the risk-signal cohort.

## Execution model

**Fully autonomous** once the FI is unambiguously resolved. No template-confirmation prompt, no step-through. The user reviews the final markdown.

Exception: if the FI identifier resolves to multiple matches, the skill must list candidates and ask which one before proceeding.

## Implementation process

### Step 1 — Fetch the data battery

Call the `db_business_outcomes_battery` MCP tool exactly once:

```
db_business_outcomes_battery({
  fi_query: "<FI identifier>",
  end_date: "<YYYY-MM-DD optional>"
})
```

This tool runs the full 10-query standard battery against the production replica and returns a single JSON payload with everything the skill needs. The tool encapsulates the non-obvious join paths (FIS GKYC via configurations table, risk-signal cohort filtering, etc.) — the skill never has to think about SQL.

**Handle the three possible response shapes:**

- `{ ok: false, error: "..." }` — stop and surface the error to the user.
- `{ ambiguous: true, candidates: [{id, name, slug}, ...] }` — list the candidates and ask the user to pick one, then re-call with the chosen `id` as `fi_query`.
- `{ ok: true, fi: {...}, product_overview: [...], decision_distribution: [...], ... }` — proceed to Step 2.

The successful payload contains:

| Field | Type | Source |
| :---- | :--- | :----- |
| `fi` | `{id, name, slug, brand: {primary_color, secondary_color, primary_logo}}` | financial_institutions row |
| `end_date` | `YYYY-MM-DD` | echoed |
| `product_overview` | rows: `{product_slug, active_flows, total_apps, complete, submitted, pending_submit, draft, canceled, failed, first_app, last_app}` | per-product status mix + activity window |
| `decision_distribution` | rows: `{product, title, decision, apps}` | reason-code rollup |
| `flow_breakdown` | rows: `{product, title, apps, decisioned, approved, denied, drafts, pending}` | per-flow performance |
| `risk_signals` | `{fg_checks, fg_decline, fg_review, fg_approve, idv_attempts, idv_clean, chex_checks, gkyc_checks, gkyc_fail, gkyc_pass, gkyc_review}` | Fraud Guard+, Cotribute IDV, Corelation Chex, FIS GKYC |
| `ofac` | `{orders, apps_checked, hits}` | watchlist totals |
| `decision_automation` | rows: `{product, apps, total_transitions, rule_transitions, admin_transitions}` | rule vs. admin transitions |
| `time_to_decision` | rows: `{product, approved, denied, median_min_to_approve, median_min_to_deny}` | median time-to-terminal-decision |
| `unique_users` | `{unique_users, total_apps, first_app, last_app}` | top-of-funnel identity capture |
| `monthly_trend` | rows: `{month, submitted, approved, denied, review}` | monthly funnel mix |
| `loan_dollars` | rows: `{slug, apps, apps_w_amount, total_demand, avg_loan, approved_dollars, denied_dollars}` | per-product loan economics (best-effort) |

### Step 2 — Color heuristic (silent)

From `fi.brand`:

- `primary_color`, `secondary_color`, `primary_logo` are the raw values.
- If `primary_color` is desaturated (RGB max-minus-min divided by max is less than 0.10), swap so the **visual** primary is `secondary_color`. The original primary becomes the accent. This is the same heuristic used in the Claude Code version — note the swap in the final summary to the user.
- If `brand.primary_color` is null, fall back to a neutral default (`#444444`) and note that no brand colors were configured.

(This step matters less in the Cowork edition since there's no PPTX, but the markdown summary references brand color and the heuristic keeps both editions consistent.)

### Step 3 — Classify product mix

Inspect `product_overview` slugs:

- **Account-opening:** slug matches `*account-opening*`, `*-cao*`, `*-bao*`, `*youth*`, `*share*`, `*subshare*`, `*idg*`, `*-te*`, `*fiduciary*`, `*estate*`, `*trust*`
- **Lending:** slug matches `*loan*`, `*-cla*`, `*credit-card*`, `*heloc*`, `*home-equity*`, `*mortgage*`
- **Service (ignored for templating):** slug matches `*ddswitch*`, `*direct-deposit*`, `*lookup*`, `*atomic*`

Decide template:

- **Multi-product** — ≥1 active AO product AND ≥1 active lending product, each with `total_apps > 50`.
- **AO-focused** — only AO products active, OR lending side is sunset (`MAX(last_app on lending products) < end_date - 90 days`).
- **Lending-only** — only lending products active.

### Step 4 — Brief pre-flight (informational)

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

### Step 5 — Synthesize markdown

Render the appropriate template (verbatim from `/Users/apaul/src/dreambigger/.claude/agents/generate-business-outcomes.md`, sections "Template A — Multi-product" / "Template B — AO-focused" / "Template C — Lending-only").

**Universal rules — DO NOT VIOLATE:**

- Always use **Cotribute IDV** (never "Plaid IDV"). Always use **Fraud Guard+** (never "Effectiv FraudGuard", "Socure", "IPQS"). Use **FIS GKYC** by its proper name. These are productized layers that whitelabel underlying vendors.
- **Never mention Clearwater** under any circumstances (also a Cotribute client).
- Never use internal Cotribute artifact names: `field_mappings`, `JSONata`, `core_banking_configurations`, `flow configuration`, `financial-application template`.
- Never use core-internal data-model names: `type serial`, `person object`, `tin/tinType`. Use plain-English equivalents — "account type", "applicant added", "tax ID".
- Reason codes in denial tables are pulled **verbatim** from `decision_distribution[].title`.
- Monthly trend formatted as a code block with 3 or 4 columns depending on data density.
- Reporting period format: `<Month D, YYYY> – <Month D, YYYY> (~N months in production)`.

### Step 6 — Recommendations

Generate 3–5 bullets matched to the data, drawing from these patterns:

| Trigger                                                | Recommendation pattern                                                                                                                                                                           |
| :----------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `draft_count / total_apps > 0.30`                      | Deploy abandoned-application nurture. With {{draft_count}} drafts on file, an automated re-engagement sequence (email + SMS) is the highest-ROI growth lever available with no platform changes. |
| `fg_checks == 0 AND idv_attempts == 0`                 | Activate Fraud Guard+ and Cotribute IDV. The platform's productized risk stack would surface fraud-driven denials at the front door and accelerate clean-applicant decisioning.                  |
| `rule_transitions == 0 AND admin_transitions > 50`     | Move decisioning from manual to rules-driven. Comparable deployments run 78–85% rules-driven, freeing the underwriting team for edge cases.                                                      |
| `has_ao AND NOT has_bao`                               | Expand into business account opening. The platform's same infrastructure supports BAO with minimal additional configuration.                                                                     |
| `has_loans AND NOT has_ao`                             | Expand into account opening. The platform currently runs lending-only; adding a consumer AO flow completes the member-acquisition motion.                                                        |
| `any flow with approval_rate < 0.30`                   | Diagnose the {{flow_name}} funnel. A {{approval_rate}}% approval rate suggests a fixable gap in pre-qualification or document collection.                                                        |
| `lowest_volume_product with apps < 20 AND has_pattern` | Promote / productize the {{product_name}} segment. Only {{apps}} applications in {{N}} months despite a clean approval pattern.                                                                  |

### Step 7 — Deliver to user

Render the markdown directly in the Cowork chat (no filesystem writes — Cowork has none). After the doc, print one final summary line:

```
✓ Business outcomes generated for <fi.name>
  Template: <multi-product | ao-focused | lending-only>
  Period: <first_app> – <end_date> (~<N> months)
  Headline: <X> applications · <Y> approvals · <Z>% automation
```

## Edge cases

- **FI with no production applications** — stop after Step 1 with a note: "FI is configured but has no application data on the replica."
- **FI with active and sunset products** — only count products with `MAX(last_app) > end_date - 90 days` as active. Sunset products go in the appendix.
- **Brand config missing** — fall back to neutral defaults and warn the user.
- **Time-to-decision is an outlier** — if median > 30 days, the data likely contains stale `decision_status_logs` from a prior FI lifecycle. Report it but flag the value as "may include legacy data" in the markdown commentary.
- **All loan products show `apps_w_amount = 0`** — loan dollars aren't captured in `financial_applications.loan_amount` for this FI. Skip the loan-dollar narrative entirely; do not write a "$0" line.

## Reference outputs

Output should be structurally equivalent to the seven manually-produced reference docs (which live on the dreambigger maintainer's machine at `~/Downloads/business-outcomes/`). When in doubt about prose phrasing, mirror those docs' tone — operator-friendly, data-forward, no vendor pitch.

## Out of scope (v1)

- **PPTX deck.** This stays a Claude Code workflow because it requires local Python. A follow-up may add a `pptxgenjs`-based switchboard tool that returns a presigned S3 URL.
- **Diff mode** for re-runs. v1 just regenerates.
- **Case-study output mode** (Story Brand framing for specific FIs). Out of scope — that remains bespoke.

## Three template variants (copy verbatim from dreambigger)

Cowork can't import other files at runtime, so the three template bodies must be embedded inline in the version of this spec that gets uploaded to Cowork's skill library. Copy the **Template A — Multi-product**, **Template B — AO-focused**, and **Template C — Lending-only** sections verbatim from `/Users/apaul/src/dreambigger/.claude/agents/generate-business-outcomes.md` (lines ~358–554 at time of writing). They are the authoritative templates.
