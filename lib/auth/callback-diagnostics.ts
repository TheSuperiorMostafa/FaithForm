/**
 * A short, machine-readable reason for the server log when an auth callback
 * could not be completed.
 *
 * The query string is attacker-controllable, so the value is matched against a
 * strict shape rather than interpolated: a reason that is not a plain
 * lowercase token becomes `unrecognised`, which keeps newlines, provider
 * wording, and anything resembling personal data out of the log line entirely.
 * The person is shown a generic marker instead; only this code is recorded.
 */
export function callbackDiagnosticCode(params: URLSearchParams): string {
  const raw = params.get("error_code") ?? params.get("error");
  if (raw === null) return "no_code";
  return /^[a-z][a-z0-9_]{0,39}$/.test(raw) ? raw : "unrecognised";
}
