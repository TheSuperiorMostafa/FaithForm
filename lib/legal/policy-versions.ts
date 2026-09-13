/**
 * The versions of FaithForm's Terms of Service and Privacy Policy, and the one
 * place they are written down.
 *
 * Two things read these and they must never disagree:
 *
 *   - `/terms` and `/privacy`, which print the version as the documents'
 *     effective date, and
 *   - the mobile API (`lib/mobile/v1/account-service.ts`), which tells every
 *     phone the version it must have accepted. A phone whose stored acceptance
 *     does not match re-prompts.
 *
 * So an edit to either document that changes what a person agreed to is a new
 * date here, which is also what makes the apps ask again. An edit that does not
 * (a typo, a clearer sentence) leaves the date alone and asks nobody anything.
 *
 * The value is an ISO date because it doubles as the effective date. It is not
 * parsed as a `Date` anywhere: `new Date("2026-08-01")` is midnight UTC, which
 * prints as July 31 for anyone west of Greenwich.
 */
export const TERMS_VERSION = "2026-08-01";
export const PRIVACY_VERSION = "2026-08-01";

/** Where people write to us about their data or their account. */
export const SUPPORT_EMAIL = "support@faithform.io";

/** The public legal routes. Middleware must let every one of them render signed-out. */
export const LEGAL_PATHS = {
  privacy: "/privacy",
  terms: "/terms",
  accountDeletion: "/account-deletion",
} as const;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * `2026-08-01` → `August 1, 2026`, from the string alone.
 *
 * Throws on anything else rather than printing a plausible wrong date on a
 * legal document; a malformed version is a build-time mistake to catch in a
 * test, not something to paper over on the page.
 */
export function formatPolicyDate(version: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(version);
  const month = match ? Number(match[2]) : 0;
  const day = match ? Number(match[3]) : 0;
  if (!match || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Policy version is not an ISO date: ${version}`);
  }
  return `${MONTHS[month - 1]} ${day}, ${match[1]}`;
}
