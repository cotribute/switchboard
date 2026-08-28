/**
 * Vendored verbatim from cotribute/webmaster `src/lib/test-leads.ts`.
 *
 * These are the exact classification rules the admin dashboard uses. They are
 * copied rather than re-derived so Switchboard's numbers reconcile with what
 * GTM sees in the portal. If the portal's copy changes, re-copy this file.
 */
/**
 * Test-lead detection.
 *
 * The `leads` table mixes real prospects with rows created during QA and
 * regression runs. There is no flag on the row, so classification is heuristic
 * and every match records a human-readable reason so a judgement call can be
 * audited (and overridden) instead of silently dropping rows.
 */

export type TestLeadVerdict = {
  isTest: boolean;
  /** Why this row was flagged. Empty when it looks like a real lead. */
  reasons: string[];
};

/** Domains that only ever belong to us or to throwaway addresses. */
const INTERNAL_DOMAINS = ["cotributemail.com", "cotribute.com"];
const DISPOSABLE_DOMAINS = [
  "example.com",
  "example.org",
  "test.com",
  "mailinator.com",
  "yopmail.com",
  "10minutemail.com",
  "guerrillamail.com",
  "sharklasers.com",
  "trashmail.com",
  "dispostable.com",
];

/** Tokens that mark an address, name or institution as synthetic. */
const TEST_TOKENS = [
  "test",
  "testing",
  "qa",
  "regression",
  "smoke",
  "dummy",
  "sample",
  "fake",
  "placeholder",
  "asdf",
  "foobar",
  "lorem",
  "noreply",
  "no-reply",
  "donotreply",
];

function hasToken(value: string, token: string): boolean {
  // Word-ish boundary so "qa" doesn't match "aqua" and "test" doesn't match "protest".
  return new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, "i").test(value);
}

function tokenHit(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.toLowerCase();
  for (const t of TEST_TOKENS) {
    if (hasToken(v, t)) return t;
  }
  return null;
}

export function classifyTestLead(lead: {
  email: string | null;
  name?: string | null;
  institution?: string | null;
}): TestLeadVerdict {
  const reasons: string[] = [];
  const email = (lead.email ?? "").trim().toLowerCase();
  const [localPart = "", domain = ""] = email.split("@");

  if (domain && INTERNAL_DOMAINS.includes(domain)) {
    reasons.push(`Internal address (@${domain}) — not an outside prospect`);
  }
  if (domain && DISPOSABLE_DOMAINS.includes(domain)) {
    reasons.push(`Disposable or example domain (@${domain})`);
  }
  if (localPart.includes("+")) {
    const tag = localPart.split("+").slice(1).join("+");
    reasons.push(`Plus-addressed alias (+${tag}) — typical of scripted runs`);
  }
  const emailToken = tokenHit(localPart.replace(/[._+-]/g, " "));
  if (emailToken) reasons.push(`Email contains "${emailToken}"`);

  const nameToken = tokenHit(lead.name);
  if (nameToken) reasons.push(`Name contains "${nameToken}"`);

  const instToken = tokenHit(lead.institution);
  if (instToken) reasons.push(`Institution contains "${instToken}"`);

  // Single-character or repeated-character junk entries.
  if (lead.name && /^([a-z])\1*$/i.test(lead.name.trim())) {
    reasons.push("Name is filler text");
  }
  if (lead.institution && /^([a-z])\1*$/i.test(lead.institution.trim())) {
    reasons.push("Institution is filler text");
  }

  return { isTest: reasons.length > 0, reasons };
}
