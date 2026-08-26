import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";
import { requireActiveAccount } from "@/lib/faithful/account";
import { churchSlugSchema } from "@/lib/faithful/schemas";

/**
 * Device installations and notification preferences.
 *
 * A provider token is a credential for reaching a person's phone. It is stored
 * because APNs and FCM need it, and it is never returned by any projection,
 * never sent to another client, and never written to a log. Every function in
 * this file is careful to return the shape of an installation without the token
 * in it.
 */

export const registerInstallationSchema = z.object({
  installId: z.string().trim().min(8).max(128),
  platform: z.enum(["ios", "android"]),
  provider: z.enum(["apns", "fcm"]),
  providerToken: z.string().trim().min(16).max(4096),
  appVersion: z.string().trim().max(40).optional(),
  clientBuild: z.coerce.number().int().min(1).optional(),
  osVersion: z.string().trim().max(40).optional(),
  locale: z.string().trim().max(20).optional(),
});

export const preferenceSchema = z.object({
  churchSlug: churchSlugSchema,
  topic: z.enum(["announcements", "events"]),
  isEnabled: z.boolean(),
});

/** Never contains the token. */
export type InstallationView = {
  installId: string;
  platform: "ios" | "android";
  isEnabled: boolean;
  lastSeenAt: string;
};

/**
 * Registers or refreshes this install.
 *
 * Upserting on `(install_id, environment)` is what makes the same phone
 * signing in as a different person safe: the row is *reassigned* to the new
 * account rather than leaving an orphan that keeps receiving the previous
 * account's notifications.
 */
export async function registerInstallation(
  userId: string,
  environment: string,
  input: unknown,
): Promise<InstallationView> {
  const parsed = registerInstallationSchema.safeParse(input);
  if (!parsed.success) {
    throw new VisitorError("invalid_input", "Could not register this device.");
  }

  const account = await requireActiveAccount(userId);
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: existing } = await admin
    .from("visitor_device_installations")
    .select("id, account_id, provider_token")
    .eq("install_id", parsed.data.installId)
    .eq("environment", environment)
    .maybeSingle();

  const rotated =
    existing && existing.provider_token !== parsed.data.providerToken;

  const row = {
    account_id: account.id,
    install_id: parsed.data.installId,
    platform: parsed.data.platform,
    environment,
    provider: parsed.data.provider,
    provider_token: parsed.data.providerToken,
    token_rotated_at: rotated ? now : (existing ? undefined : null),
    app_version: parsed.data.appVersion ?? null,
    client_build: parsed.data.clientBuild ?? null,
    os_version: parsed.data.osVersion ?? null,
    locale: parsed.data.locale ?? null,
    authorization_version: account.authorizationVersion,
    is_enabled: true,
    // A re-registration clears a previous invalidation: the OS just handed us a
    // live token, which is better evidence than an old provider rejection.
    invalidated_at: null,
    invalidated_reason: null,
    last_seen_at: now,
    updated_at: now,
  };

  const { data, error } = await admin
    .from("visitor_device_installations")
    .upsert(row, { onConflict: "install_id,environment" })
    .select("install_id, platform, is_enabled, last_seen_at")
    .maybeSingle();

  if (error || !data) {
    throw new VisitorError("unavailable", "Could not register this device.");
  }

  return {
    installId: data.install_id as string,
    platform: data.platform as "ios" | "android",
    isEnabled: Boolean(data.is_enabled),
    lastSeenAt: data.last_seen_at as string,
  };
}

/**
 * Sign-out and account removal.
 *
 * Disables rather than deletes so a later re-registration of the same install
 * is recognisable, and clears the token so nothing can be sent to it in the
 * meantime.
 */
export async function retireInstallationsForAccount(
  accountId: string,
  reason: "signed_out" | "account_deleted",
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("visitor_device_installations")
    .update({
      is_enabled: false,
      invalidated_at: new Date().toISOString(),
      invalidated_reason: reason,
      // The token is cleared, not kept alongside a disabled flag: a disabled
      // row with a live token is one bug away from being used.
      provider_token: "",
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", accountId)
    .eq("is_enabled", true);
}

/** Retires one install — used when a device signs out but others stay signed in. */
export async function retireInstallation(
  userId: string,
  environment: string,
  installId: string,
): Promise<void> {
  const account = await requireActiveAccount(userId);
  const admin = createAdminClient();
  await admin
    .from("visitor_device_installations")
    .update({
      is_enabled: false,
      invalidated_at: new Date().toISOString(),
      invalidated_reason: "signed_out",
      provider_token: "",
      updated_at: new Date().toISOString(),
    })
    .eq("install_id", installId)
    .eq("environment", environment)
    // Exact account predicate: an install id from another account matches
    // nothing rather than being retired by a guess.
    .eq("account_id", account.id);
}

/**
 * A provider told us this token is gone. Deactivate rather than delete so the
 * next registration from the same install is recognised as a rotation.
 */
export async function invalidateToken(
  providerToken: string,
  reason: string,
): Promise<void> {
  if (!providerToken) return;
  const admin = createAdminClient();
  await admin
    .from("visitor_device_installations")
    .update({
      is_enabled: false,
      invalidated_at: new Date().toISOString(),
      invalidated_reason: reason,
      provider_token: "",
      updated_at: new Date().toISOString(),
    })
    .eq("provider_token", providerToken);
}

export type NotificationPreference = {
  churchSlug: string;
  topic: "announcements" | "events";
  isEnabled: boolean;
};

export async function listPreferences(
  userId: string,
): Promise<NotificationPreference[]> {
  const account = await requireActiveAccount(userId);
  const admin = createAdminClient();

  const { data } = await admin
    .from("visitor_notification_preferences")
    .select("topic, is_enabled, churches!inner(slug)")
    .eq("account_id", account.id)
    .limit(100);

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const church = row.churches as { slug: string } | { slug: string }[];
    const resolved = Array.isArray(church) ? church[0] : church;
    return {
      churchSlug: resolved.slug,
      topic: row.topic as NotificationPreference["topic"],
      isEnabled: Boolean(row.is_enabled),
    };
  });
}

/**
 * A preference may only be set for a church the account actually has a usable
 * relationship with — otherwise it would be a way to discover whether a private
 * church exists.
 */
export async function setPreference(
  userId: string,
  input: unknown,
): Promise<NotificationPreference> {
  const parsed = preferenceSchema.safeParse(input);
  if (!parsed.success) {
    throw new VisitorError("invalid_input", "Check the values you entered.");
  }

  const account = await requireActiveAccount(userId);
  const admin = createAdminClient();

  const { data: church } = await admin
    .from("churches")
    .select("id")
    .eq("slug", parsed.data.churchSlug)
    .maybeSingle();

  if (!church) throw new VisitorError("church_not_found", "Church not found.");

  const { data: relationship } = await admin
    .from("visitor_church_relationships")
    .select("state")
    .eq("account_id", account.id)
    .eq("church_id", church.id as string)
    .maybeSingle();

  if (!relationship || relationship.state === "blocked") {
    throw new VisitorError(
      "relationship_not_found",
      "You do not follow that church.",
    );
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from("visitor_notification_preferences")
    .upsert(
      {
        account_id: account.id,
        church_id: church.id as string,
        topic: parsed.data.topic,
        is_enabled: parsed.data.isEnabled,
        updated_at: now,
      },
      { onConflict: "account_id,church_id,topic" },
    );

  if (error) throw new VisitorError("unavailable", "Could not save that preference.");

  return {
    churchSlug: parsed.data.churchSlug,
    topic: parsed.data.topic,
    isEnabled: parsed.data.isEnabled,
  };
}
