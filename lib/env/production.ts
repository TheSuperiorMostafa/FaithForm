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

export class ProductionEnvError extends Error {
  readonly failedChecks: readonly string[];

  constructor(failedChecks: readonly string[]) {
    super("Production environment validation failed");
    this.name = "ProductionEnvError";
    this.failedChecks = failedChecks;
  }
}

function recordCheck(name: string, run: () => void, failedChecks: string[]): void {
  try {
    run();
  } catch {
    failedChecks.push(name);
  }
}

export function assertProductionEnv(): void {
  if (!isProduction() || validated) return;

  const failedChecks: string[] = [];

  recordCheck("NEXT_PUBLIC_SUPABASE_URL", () => {
    assertUrl("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL, true);
  }, failedChecks);
  recordCheck("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", () => {
    assertValue(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  }, failedChecks);
  recordCheck("SUPABASE_SECRET_KEY", () => {
    assertSecret(
      "SUPABASE_SECRET_KEY",
      process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  }, failedChecks);
  recordCheck("NEXT_PUBLIC_SITE_URL", () => {
    assertUrl("NEXT_PUBLIC_SITE_URL", process.env.NEXT_PUBLIC_SITE_URL, true);
  }, failedChecks);

  const secrets = new Map<string, string>();
  const secretNames = [
    "DONOR_PORTAL_SESSION_SECRET",
    "INTEGRATION_OAUTH_STATE_SECRET",
    "N8N_WEBHOOK_SECRET",
    "RATE_LIMIT_KEY_SECRET",
    "STREAM_RELAY_WEBHOOK_SECRET",
    "STREAM_RELAY_PLAYBACK_SECRET",
    "STREAM_INGEST_SIGNING_SECRET",
    "STREAM_PLAYBACK_SECRET",
    "CRON_SECRET",
    // **Added in Prompt 8, and it closes a real hole.** Before this, the only
    // reference to `ATTENDANCE_QR_SECRET` anywhere outside tests was the one
    // place that read it — so a production deployment passed its own
    // environment audit with QR check-in entirely unconfigured, and every
    // attempt to start a display failed silently at the church rather than
    // loudly at deploy time.
    //
    // It is required rather than optional because it now signs four different
    // capabilities: the rotating QR, the projector's display capability, the
    // pairing codes, and the kiosk credentials. A deployment without it has no
    // QR check-in, no short-code fallback, and no kiosk mode.
    "ATTENDANCE_QR_SECRET",
  ] as const;

  for (const name of secretNames) {
    recordCheck(name, () => {
      secrets.set(name, assertSecret(name, process.env[name]));
    }, failedChecks);
  }

  if (secrets.size === secretNames.length) {
    const uniqueSecretValues = new Set(secrets.values());
    if (uniqueSecretValues.size !== secrets.size) {
      failedChecks.push("unique-secret-values");
    }
  }

  recordCheck("STREAM_HLS_UPSTREAM_URL", () => {
    assertSecureStreamUrl(
      "STREAM_HLS_UPSTREAM_URL",
      process.env.STREAM_HLS_UPSTREAM_URL,
      ["https:"],
    );
  }, failedChecks);
  recordCheck("STREAM_WS_INGEST_UPSTREAM_URL", () => {
    assertSecureStreamUrl(
      "STREAM_WS_INGEST_UPSTREAM_URL",
      process.env.STREAM_WS_INGEST_UPSTREAM_URL,
      ["wss:", "https:"],
    );
  }, failedChecks);
  recordCheck("STRIPE_SECRET_KEY", () => {
    assertValue("STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY);
  }, failedChecks);
  recordCheck("STRIPE_WEBHOOK_SECRET", () => {
    assertSecret("STRIPE_WEBHOOK_SECRET", process.env.STRIPE_WEBHOOK_SECRET);
  }, failedChecks);
  recordCheck("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", () => {
    assertValue(
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    );
  }, failedChecks);
  recordCheck("RESEND_API_KEY", () => {
    assertValue("RESEND_API_KEY", process.env.RESEND_API_KEY);
  }, failedChecks);

  if (failedChecks.length > 0) {
    throw new ProductionEnvError(failedChecks);
  }

  validated = true;
}
