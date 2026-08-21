const PLACEHOLDER_PARTS = [
  "replace-me",
  "xxxxxxxx",
  "your-project",
  "example",
];

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function assertValue(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Missing required production env: ${name}`);
  if (PLACEHOLDER_PARTS.some((part) => normalized.toLowerCase().includes(part))) {
    throw new Error(`Production env ${name} contains a placeholder`);
  }
  return normalized;
}

function assertSecret(name: string, value: string | undefined): string {
  const secret = assertValue(name, value);
  if (secret.length < 32) {
    throw new Error(`Production env ${name} must contain at least 32 characters`);
  }
  return secret;
}

function assertUrl(name: string, value: string | undefined, https = false): void {
  const raw = assertValue(name, value);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Production env ${name} must be a valid URL`);
  }
  if (https && url.protocol !== "https:") {
    throw new Error(`Production env ${name} must use HTTPS`);
  }
}

function assertSecureStreamUrl(
  name: string,
  value: string | undefined,
  protocols: readonly string[],
): void {
  const raw = assertValue(name, value);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Production env ${name} must be a valid URL`);
  }
  if (!protocols.includes(url.protocol)) {
    throw new Error(
      `Production env ${name} must use ${protocols.join(" or ")}`,
    );
  }
}

let validated = false;

export function assertProductionEnv(): void {
  if (!isProduction() || validated) return;

  assertUrl("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL, true);
  assertValue(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  assertSecret(
    "SUPABASE_SECRET_KEY",
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  assertUrl("NEXT_PUBLIC_SITE_URL", process.env.NEXT_PUBLIC_SITE_URL, true);

  const secrets = new Map<string, string>([
    [
      "DONOR_PORTAL_SESSION_SECRET",
      assertSecret(
        "DONOR_PORTAL_SESSION_SECRET",
        process.env.DONOR_PORTAL_SESSION_SECRET,
      ),
    ],
    [
      "INTEGRATION_OAUTH_STATE_SECRET",
      assertSecret(
        "INTEGRATION_OAUTH_STATE_SECRET",
        process.env.INTEGRATION_OAUTH_STATE_SECRET,
      ),
    ],
    [
      "N8N_WEBHOOK_SECRET",
      assertSecret("N8N_WEBHOOK_SECRET", process.env.N8N_WEBHOOK_SECRET),
    ],
    [
      "RATE_LIMIT_KEY_SECRET",
      assertSecret("RATE_LIMIT_KEY_SECRET", process.env.RATE_LIMIT_KEY_SECRET),
    ],
    [
      "STREAM_RELAY_WEBHOOK_SECRET",
      assertSecret(
        "STREAM_RELAY_WEBHOOK_SECRET",
        process.env.STREAM_RELAY_WEBHOOK_SECRET,
      ),
    ],
    [
      "STREAM_RELAY_PLAYBACK_SECRET",
      assertSecret(
        "STREAM_RELAY_PLAYBACK_SECRET",
        process.env.STREAM_RELAY_PLAYBACK_SECRET,
      ),
    ],
    [
      "STREAM_INGEST_SIGNING_SECRET",
      assertSecret(
        "STREAM_INGEST_SIGNING_SECRET",
        process.env.STREAM_INGEST_SIGNING_SECRET,
      ),
    ],
    [
      "STREAM_PLAYBACK_SECRET",
      assertSecret("STREAM_PLAYBACK_SECRET", process.env.STREAM_PLAYBACK_SECRET),
    ],
    ["CRON_SECRET", assertSecret("CRON_SECRET", process.env.CRON_SECRET)],
  ]);

  const uniqueSecretValues = new Set(secrets.values());
  if (uniqueSecretValues.size !== secrets.size) {
    throw new Error("Production security secrets must use separate values");
  }

  assertSecureStreamUrl(
    "STREAM_HLS_UPSTREAM_URL",
    process.env.STREAM_HLS_UPSTREAM_URL,
    ["https:"],
  );
  assertSecureStreamUrl(
    "STREAM_WS_INGEST_UPSTREAM_URL",
    process.env.STREAM_WS_INGEST_UPSTREAM_URL,
    ["wss:", "https:"],
  );
  assertValue("STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY);
  assertSecret("STRIPE_WEBHOOK_SECRET", process.env.STRIPE_WEBHOOK_SECRET);
  assertValue(
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  );
  assertValue("RESEND_API_KEY", process.env.RESEND_API_KEY);

  validated = true;
}
