/**
 * Vendored verbatim from cotribute/webmaster `src/lib/talk-page.ts`.
 *
 * These are the exact classification rules the admin dashboard uses. They are
 * copied rather than re-derived so Switchboard's numbers reconcile with what
 * GTM sees in the portal. If the portal's copy changes, re-copy this file.
 */
/** Paths that represent the "Talk with us" / contact page on www.cotribute.com. */
export const TALK_WITH_US_PATHS = [
  "/talk-with-us",
  "/talk",
  "/contact",
  "/contact-us",
  "/get-started",
  "/demo",
  "/book-a-demo",
  "/book-a-call",
];

/** Case-insensitive path match, ignoring query strings and trailing slashes. */
export function isTalkWithUsPath(path: string | null | undefined): boolean {
  if (!path) return false;
  let p = path.trim().toLowerCase();
  const q = p.search(/[?#]/);
  if (q >= 0) p = p.slice(0, q);
  if (p.length > 1) p = p.replace(/\/+$/, "");
  if (!p.startsWith("/")) p = `/${p}`;
  return TALK_WITH_US_PATHS.includes(p);
}
