import { StreamChat, type PushProviderConfig } from "stream-chat";
import { readApnsConfig } from "@/lib/faithform/push/provider-auth";
import { readMessagingConfig } from "@/lib/messaging/config";

export function apnProviderName(base: string, environment?: "development" | "production" | null): string {
  return environment === "development" ? `${base}-development` : base;
}

let configured: Promise<boolean> | null = null;

/** Configure both Apple environments from the same server-side APNs key.
 * The cron and device mirror share this setup; configuring APNs on Vercel
 * must also configure the chat delivery provider, which sends independently.
 */
export async function ensureChatPushConfigured(): Promise<boolean> {
  if (configured) return configured;
  configured = configure().catch(() => {
    configured = null;
    throw new Error("chat_push_configuration_failed");
  });
  const ready = await configured;
  if (!ready) configured = null;
  return ready;
}

async function configure(): Promise<boolean> {
  const config = readMessagingConfig();
  const apple = readApnsConfig();
  const topic = process.env.APNS_TOPIC?.trim();
  if (!config || !apple || !topic) return false;
  const client = new StreamChat(config.apiKey, config.apiSecret, { timeout: 8000 });
  await client.updateAppSettings({ push_config: { version: "v2", offline_only: false } });
  for (const environment of ["production", "development"] as const) {
    const provider = {
      name: apnProviderName(config.apnProviderName, environment),
      type: "apn",
      apn_auth_type: "token",
      apn_auth_key: apple.privateKeyPem,
      apn_key_id: apple.keyId,
      apn_team_id: apple.teamId,
      apn_topic: topic,
      apn_development: environment === "development",
    } satisfies Omit<PushProviderConfig, "created_at" | "updated_at">;
    // The SDK includes server-generated response timestamps in the request
    // type; the provider API accepts the configuration without them.
    await client.upsertPushProvider(provider as PushProviderConfig);
  }
  return true;
}
