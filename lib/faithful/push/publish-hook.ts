import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClientOrNull } from "@/lib/supabase/admin";
import {
  cancelNotificationsForSubject,
  enqueuePublicationNotification,
} from "@/lib/faithful/push/outbox";

/**
 * The bridge from FaithForm publication to Faithful delivery.
 *
 * Called immediately after the canonical announcement row is saved, so a
 * published announcement always has its notification recorded and a
 * notification never exists for something unpublished.
 *
 * Everything here is best-effort *in the direction that matters*: a failure to
 * enqueue is reported to the caller but never rolls back or corrupts the
 * publication itself. An announcement that is published but whose push failed
 * is recoverable; a push for an announcement that was not published is not.
 */

export type MobilePublicationInput = {
  churchId: string;
  announcementId: string;
  title: string;
  body: string | null;
  visibility: "none" | "public" | "followers" | "members";
  isPinned: boolean;
  pinnedUntil: string | null;
  posterAltText: string | null;
  hasEndDate: boolean;
};

export type MobilePublicationResult = {
  applied: boolean;
  enqueued: boolean;
  /** Present when migration 0054 has not been applied to this database. */
  unavailableReason?: string;
};

function isMissingMobileColumn(message: string): boolean {
  return /mobile_visibility|is_pinned|pinned_until|poster_alt_text|publication_version|mobile_published_at|notification_outbox/i.test(
    message,
  );
}

/**
 * Applies the mobile projection fields and enqueues delivery.
 *
 * Tolerates a database that has not yet received 0054 the same way the rest of
 * this codebase tolerates a partially-applied migration history: the web
 * publication path keeps working and the mobile half reports itself
 * unavailable, rather than the whole publish failing.
 */
export async function applyMobilePublication(
  input: MobilePublicationInput,
  client?: SupabaseClient,
): Promise<MobilePublicationResult> {
  const admin = client ?? createAdminClientOrNull();
  if (!admin) return { applied: false, enqueued: false, unavailableReason: "no_admin_client" };

  const now = new Date().toISOString();

  const { data: church } = await admin
    .from("churches")
    .select("slug")
    .eq("id", input.churchId)
    .maybeSingle();

  const churchSlug = (church?.slug as string | null) ?? null;

  const { data: updated, error } = await admin
    .from("announcements")
    .update({
      mobile_visibility: input.visibility,
      is_pinned: input.isPinned,
      pinned_until: input.pinnedUntil,
      poster_alt_text: input.posterAltText,
      mobile_published_at: input.visibility === "none" ? null : now,
      mobile_unpublished_at: input.visibility === "none" ? now : null,
    })
    .eq("id", input.announcementId)
    // Exact tenant predicate even on an admin client.
    .eq("church_id", input.churchId)
    .select("publication_version")
    .maybeSingle();

  if (error) {
    return {
      applied: false,
      enqueued: false,
      unavailableReason: isMissingMobileColumn(error.message)
        ? "migration_0054_missing"
        : "update_failed",
    };
  }

  // Withdrawing from the app also withdraws anything not yet delivered.
  if (input.visibility === "none") {
    await cancelNotificationsForSubject(input.announcementId, admin).catch(() => undefined);
    return { applied: true, enqueued: false };
  }

  if (!churchSlug) {
    // Without a public handle a deep link cannot be built, so there is nothing
    // useful to notify anyone about.
    return { applied: true, enqueued: false, unavailableReason: "church_has_no_slug" };
  }

  // A prior version's pending notification is superseded by this one.
  await cancelNotificationsForSubject(input.announcementId, admin).catch(() => undefined);

  const result = await enqueuePublicationNotification(
    {
      churchId: input.churchId,
      announcementId: input.announcementId,
      churchSlug,
      title: input.title,
      body: input.body,
      visibility: input.visibility,
      publicationVersion: Number(updated?.publication_version ?? 1),
      topic: input.hasEndDate ? "events" : "announcements",
    },
    admin,
  );

  return { applied: true, enqueued: result.enqueued };
}

/** Unpublishing from the web also removes it from the app and cancels delivery. */
export async function withdrawMobilePublication(
  churchId: string,
  announcementId: string,
  client?: SupabaseClient,
): Promise<void> {
  const admin = client ?? createAdminClientOrNull();
  if (!admin) return;

  const now = new Date().toISOString();
  await admin
    .from("announcements")
    .update({ mobile_visibility: "none", mobile_unpublished_at: now })
    .eq("id", announcementId)
    .eq("church_id", churchId);

  await cancelNotificationsForSubject(announcementId, admin).catch(() => undefined);
}
