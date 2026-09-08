/**
 * The address every FaithForm email is sent from.
 *
 * ## Why this is a function and not `process.env.RESEND_FROM_EMAIL`
 *
 * `onboarding@resend.dev` is Resend's shared testing sender. It is not ours, it
 * carries no FaithForm DKIM signature, and Resend restricts it to the address
 * that owns the account, so a church invite sent from it reaches nobody except
 * us. That is not a delivery problem anyone can debug from the outside: the
 * invite records as sent, the pastor never receives it, and the only way to get
 * a church set up is to invite yourself and hand it over afterwards.
 *
 * It reached production as an env override that was never taken back out, which
 * is a mistake this will keep making. So the sandbox sender is treated as
 * absent rather than obeyed: it names a mailbox on somebody else's domain, and
 * there is no deployment of this product where sending as it is the intent.
 *
 * The fallback is safe because it is the same domain the app already sends
 * every other email from, verified in Resend since June.
 */

/** Our own verified domain, and the default when nothing else is configured. */
export const DEFAULT_FROM_ADDRESS = "noreply@faithform.io";

/** Resend's shared sandbox domain. Never a sender we mean to use. */
const SANDBOX_SENDER_DOMAIN = "resend.dev";

export function isSandboxSender(address: string): boolean {
  const domain = address.split("@").pop()?.trim().toLowerCase() ?? "";
  return domain === SANDBOX_SENDER_DOMAIN || domain.endsWith(`.${SANDBOX_SENDER_DOMAIN}`);
}

/**
 * `RESEND_FROM_EMAIL` when it names a real mailbox of ours, and the default
 * otherwise: including when it is blank, whitespace, or the sandbox sender.
 */
export function resolveFromAddress(): string {
  const configured = process.env.RESEND_FROM_EMAIL?.trim();
  if (!configured) return DEFAULT_FROM_ADDRESS;

  if (isSandboxSender(configured)) {
    console.warn(
      `[email] ignoring RESEND_FROM_EMAIL=${configured}: Resend's sandbox sender only delivers to the account owner. Sending as ${DEFAULT_FROM_ADDRESS} instead.`,
    );
    return DEFAULT_FROM_ADDRESS;
  }

  return configured;
}
