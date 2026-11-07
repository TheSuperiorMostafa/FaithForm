/**
 * Notification outbox worker processor
 * Handles group_announcement and other notification kinds
 */

import { createAdminClient } from "@/lib/supabase/admin";

export async function processNotificationOutbox(batchSize = 50) {
  const db = createAdminClient();
  
  // Fetch pending notifications
  const { data: pending, error } = await db
    .from("notification_outbox")
    .select("*")
    .eq("status", "pending")
    .limit(batchSize);

  if (error || !pending) {
    console.error("Failed to fetch notifications:", error);
    return { processed: 0, failed: 0 };
  }

  let processed = 0;
  let failed = 0;

  for (const notification of pending) {
    try {
      // Mark as processing
      await db
        .from("notification_outbox")
        .update({ status: "processing" })
        .eq("id", notification.id);

      // Handle different notification kinds
      if (notification.kind === "group_announcement") {
        await processGroupAnnouncement(notification, db);
      }
      // Add other notification handlers here

      // Mark as delivered
      await db
        .from("notification_outbox")
        .update({ 
          status: "delivered",
          delivered_at: new Date().toISOString(),
        })
        .eq("id", notification.id);

      processed++;
    } catch (error) {
      console.error(`Failed to process notification ${notification.id}:`, error);
      
      // Mark as failed
      await db
        .from("notification_outbox")
        .update({ 
          status: "failed",
          error_message: error instanceof Error ? error.message : "Unknown error",
        })
        .eq("id", notification.id);

      failed++;
    }
  }

  return { processed, failed };
}

async function processGroupAnnouncement(notification: any, db: any) {
  // In production, this would send push notifications
  // For testing, we just mark as delivered
  console.log(`[TEST MODE] Would send group announcement to ${notification.target_account_ids?.length || 0} members`);
  
  // Check user preferences before sending (stub)
  // const preferences = await getUserNotificationPreferences(notification.target_account_ids, db);
  // Filter recipients based on preferences
  
  // In production: call push notification service
  // await sendPushNotification({ ... });
}
