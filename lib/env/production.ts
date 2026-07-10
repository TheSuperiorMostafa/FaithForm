const PLACEHOLDER_SECRETS = new Set(["replace-me", "replace-me-long-random-string"]);

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function assertSecret(name: string, value: string | undefined): void {
  if (!value?.trim()) {
    throw new Error(`Missing required production env: ${name}`);
  }
  if (PLACEHOLDER_SECRETS.has(value.trim())) {
    throw new Error(`Production env ${name} must not use placeholder value`);
  }
}

let validated = false;

export function assertProductionEnv(): void {
  if (!isProduction() || validated) return;

  assertSecret("DONOR_PORTAL_SESSION_SECRET", process.env.DONOR_PORTAL_SESSION_SECRET);
  assertSecret(
    "INTEGRATION_OAUTH_STATE_SECRET",
    process.env.INTEGRATION_OAUTH_STATE_SECRET,
  );
  assertSecret("N8N_WEBHOOK_SECRET", process.env.N8N_WEBHOOK_SECRET);

  validated = true;
}
