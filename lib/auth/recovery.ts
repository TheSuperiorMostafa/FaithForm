/**
 * Recognises a session minted by a password-recovery link.
 *
 * The recovery flow is supposed to carry `next=/set-password?reason=recovery`
 * through the redirect — but Supabase falls back to the bare Site URL whenever
 * the redirect isn't on its allow-list, and the instruction is lost. The
 * session itself still knows: GoTrue stamps the authentication method into the
 * token's `amr` claim. Reading it makes the outcome independent of dashboard
 * configuration — a reset link sets a password, full stop.
 *
 * The token is decoded, not verified: it was obtained one line earlier from
 * `exchangeCodeForSession` against our own Supabase project, and the claim is
 * only used to choose which of two signed-in destinations to show.
 */

type AmrEntry = { method?: string; timestamp?: number };

export function sessionCameFromRecovery(accessToken: string | undefined): boolean {
  if (!accessToken) return false;

  const payload = accessToken.split(".")[1];
  if (!payload) return false;

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { amr?: AmrEntry[] };

    const entries = Array.isArray(decoded.amr) ? decoded.amr : [];
    if (entries.length === 0) return false;

    // The freshest method is the one this exchange represents; an old
    // password login lingering in the history must not hijack a magic link.
    const latest = entries.reduce((a, b) =>
      (b.timestamp ?? 0) > (a.timestamp ?? 0) ? b : a,
    );
    return latest.method === "recovery";
  } catch {
    return false;
  }
}
