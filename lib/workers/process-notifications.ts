/**
 * Notification outbox worker processor
 * Handles group_announcement and other notification kinds using real push dispatch.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { 
  ApnsAdapter, 
  FcmAdapter,
  type PushAdapter,
  type PushMessage,
  type DeliveryResult 
} from "@/lib/faithform/push/adapters";
import { invalidateToken } from "@/lib/faithform/push/installations";

type PushRecipient = {
  installationId: string;
  token: string;
  provider: "apns" | "fcm";
  apnsEnvironment?: "development" | "production" | null;
};

/**
 * Process notification outbox entries, dispatching via real push providers.
 * Handles retries, token invalidation, and delivery tracking.
 */
export async function processNotificationOutbox(batchSize = 50) {
  const admin = createAdminClient();
  
  const { data: pending, error } = await admin
    .from("notification_outbox")
    .select("*")
    .eq("status", "pending")
    .limit(batchSize);

  if (error || !pending) {
    console.error("[outbox] Failed to fetch notifications:", error);
    return { processed: 0, failed: 0 };
  }

  let processed = 0;
  let failed = 0;

  for (const notification of pending) {
    try {
      await admin
        .from("notification_outbox")
        .update({ status: "processing", attempts: (notification.attempts || 0) + 1 })
        .eq("id", notification.id);

      if (notification.kind === "group_announcement") {
        await dispatchGroupAnnouncement(notification, admin);
      } else {
        console.warn(`[outbox] Unhandled notification kind: ${notification.kind}`);
      }

      await admin
        .from("notification_outbox")
        .update({ 
          status: "delivered",
          delivered_at: new Date().toISOString(),
        })
        .eq("id", notification.id);

      processed++;
    } catch (error) {
      console.error(`[outbox] Failed to process ${notification.id}:`, error);
      
      const shouldRetry = (notification.attempts || 0) < 3;
      await admin
        .from("notification_outbox")
        .update({ 
          status: shouldRetry ? "retryable" : "failed",
          error_message: error instanceof Error ? error.message : "Unknown error",
          next_attempt_after: shouldRetry ? new Date(Date.now() + Math.pow(2, notification.attempts || 0) * 60_000).toISOString() : null,
        })
        .eq("id", notification.id);

      failed++;
    }
  }

  return { processed, failed };
}

/**
 * Dispatch group announcement via real push notification providers.
 * Resolves installations, sends via APNs/FCM, tracks delivery, handles token invalidation.
 */
async function dispatchGroupAnnouncement(notification: any, admin: any) {
  if (!notification.target_account_ids || notification.target_account_ids.length === 0) {
    throw new Error("No target accounts");
  }

  // Load push installations for target accounts
  const { data: installations } = await admin
    .from("push_installations")
    .select("id, token, provider, apns_environment, account_id")
    .in("account_id", notification.target_account_ids)
    .eq("is_active", true)
    .limit(1000);

  if (!installations || installations.length === 0) {
    console.log(`[outbox] No active installations for ${notification.id}`);
    return;
  }

  const recipients: PushRecipient[] = installations.map((i: any) => ({
    installationId: i.id,
    token: i.token,
    provider: i.provider,
    apnsEnvironment: i.apns_environment,
  }));

  const message: PushMessage = {
    title: notification.title,
    body: notification.body,
    deepLink: notification.deep_link || "faithform://groups",
    collapseKey: notification.collapse_key || `group-${notification.subject_id}`,
    correlationId: notification.id,
    topic: "groups",
  };

  const adapters: Record<string, PushAdapter> = {
    apns: new ApnsAdapter(),
    fcm: new FcmAdapter(),
  };

  // Check if providers are configured
  const hasApns = adapters.apns.isConfigured();
  const hasFcm = adapters.fcm.isConfigured();

  if (!hasApns && !hasFcm) {
    console.warn("[outbox] No push providers configured, skipping actual send (test mode)");
    return;
  }

  let anyRetryable = false;

  // Send to each recipient
  for (const recipient of recipients) {
    const adapter = adapters[recipient.provider];
    
    if (!adapter.isConfigured()) {
      console.log(`[outbox] ${recipient.provider} not configured, skipping installation ${recipient.installationId}`);
      continue;
    }

    try {
      const outcome: DeliveryResult = await adapter.send(
        recipient.token, 
        message, 
        recipient.apnsEnvironment
      );

      // Record delivery attempt
      await admin.from("notification_delivery_attempts").insert({
        outbox_id: notification.id,
        installation_id: recipient.installationId,
        provider: recipient.provider,
        attempt_number: notification.attempts || 1,
        outcome: outcome.outcome,
        error_category: outcome.errorCategory ?? null,
        provider_status: outcome.providerStatus ?? null,
      });

      if (outcome.invalidToken) {
        await invalidateToken(recipient.token, outcome.errorCategory ?? "invalid_token");
      }

      if (outcome.outcome === "retryable") {
        anyRetryable = true;
      }
    } catch (error) {
      console.error(`[outbox] Send failed for installation ${recipient.installationId}:`, error);
      anyRetryable = true;
    }
  }

  if (anyRetryable) {
    throw new Error("Some deliveries failed with retryable errors");
  }
}
