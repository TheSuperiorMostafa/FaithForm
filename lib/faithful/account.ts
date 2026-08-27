import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { VisitorError } from "@/lib/faithful/errors";
import {
  consentSchema,
  visitorProfileSchema,
  churchSlugSchema,
} from "@/lib/faithful/schemas";

export type VisitorAccount = {
  id: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: "active" | "deactivated" | "deletion_requested" | "deleted";
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  privacyVersion: string | null;
  privacyAcceptedAt: string | null;
  autoAttendanceConsent: "unset" | "granted" | "denied" | "revoked";
  communicationPrefs: Record<string, boolean>;
  selectedChurchId: string | null;
  authorizationVersion: number;
};

const ACCOUNT_COLUMNS =
  "id, user_id, display_name, avatar_url, status, terms_version, terms_accepted_at, privacy_version, privacy_accepted_at, auto_attendance_consent, communication_prefs, selected_church_id, authorization_version";

function mapAccount(row: Record<string, unknown>): VisitorAccount {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    displayName: (row.display_name as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    status: row.status as VisitorAccount["status"],
    termsVersion: (row.terms_version as string | null) ?? null,
    termsAcceptedAt: (row.terms_accepted_at as string | null) ?? null,
    privacyVersion: (row.privacy_version as string | null) ?? null,
    privacyAcceptedAt: (row.privacy_accepted_at as string | null) ?? null,
    autoAttendanceConsent:
      row.auto_attendance_consent as VisitorAccount["autoAttendanceConsent"],
    communicationPrefs:
      (row.communication_prefs as Record<string, boolean> | null) ?? {},
    selectedChurchId: (row.selected_church_id as string | null) ?? null,
    authorizationVersion: (row.authorization_version as number | null) ?? 1,
  };
}

/** The signed-in user, resolved server-side. A client-supplied id is never trusted. */
export async function requireUserId(supabase?: SupabaseClient): Promise<string> {
  const client = supabase ?? createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new VisitorError("unauthenticated", "You must be signed in.");
  return user.id;
}

/**
 * Idempotent by construction: the unique index on user_id makes a concurrent
 * double-create collapse into one row, and the conflict path re-reads rather
 * than failing. Two devices signing in at once both end up with the same
 * account.
 */
export async function ensureVisitorAccount(
  userId: string,
  defaults?: { displayName?: string | null },
): Promise<VisitorAccount> {
  const admin = createAdminClient();

  const existing = await admin
    .from("visitor_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing.data) return mapAccount(existing.data);

  const inserted = await admin
    .from("visitor_accounts")
    .insert({
      user_id: userId,
      display_name: defaults?.displayName ?? null,
    })
    .select(ACCOUNT_COLUMNS)
    .maybeSingle();

  if (inserted.data) return mapAccount(inserted.data);

  // Lost the race. The row now exists; read it rather than surfacing a
  // duplicate-key error to someone who simply opened the app twice.
  const retry = await admin
    .from("visitor_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (!retry.data) {
    throw new VisitorError("unavailable", "Could not create your account.");
  }
  return mapAccount(retry.data);
}

export async function getVisitorAccount(
  userId: string,
): Promise<VisitorAccount | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("visitor_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? mapAccount(data) : null;
}

export async function requireActiveAccount(
  userId: string,
): Promise<VisitorAccount> {
  const account = await getVisitorAccount(userId);
  if (!account) throw new VisitorError("account_missing", "No visitor account.");
  if (account.status !== "active") {
    throw new VisitorError("account_inactive", "This account is not active.");
  }
  return account;
}

/**
 * Any change that could make a device's cached authorization wrong bumps the
 * version. Prompt 4 compares it; Prompt 3's job is to make sure it moves.
 */
export async function bumpAuthorizationVersion(
  accountId: string,
  client?: SupabaseClient,
): Promise<void> {
  const admin = client ?? createAdminClient();
  const { data } = await admin
    .from("visitor_accounts")
    .select("authorization_version")
    .eq("id", accountId)
    .maybeSingle();

  const next = ((data?.authorization_version as number | null) ?? 1) + 1;
  await admin
    .from("visitor_accounts")
    .update({ authorization_version: next, updated_at: new Date().toISOString() })
    .eq("id", accountId);
}

export async function updateVisitorProfile(
  userId: string,
  input: unknown,
): Promise<VisitorAccount> {
  const parsed = visitorProfileSchema.safeParse(input);
  if (!parsed.success) {
    throw new VisitorError("invalid_input", "Check the values you entered.");
  }

  // Ensured, not merely required: setting a display name right after account
  // creation *is* the first authenticated use, which Prompt 3 defines as the
  // moment the visitor row materializes. Requiring the row to already exist
  // made that first write silently race the first bootstrap. The lifecycle
  // guard stays: a deactivated or deletion-requested account still may not
  // mutate anything.
  const account = await ensureVisitorAccount(userId);
  if (account.status !== "active") {
    throw new VisitorError("account_inactive", "This account is not active.");
  }
  const admin = createAdminClient();

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.displayName !== undefined) {
    update.display_name = parsed.data.displayName;
  }
  if (parsed.data.avatarUrl !== undefined) update.avatar_url = parsed.data.avatarUrl;
  if (parsed.data.communicationPrefs !== undefined) {
    update.communication_prefs = parsed.data.communicationPrefs;
  }

  // Selecting a church is a preference. It is resolved from a public slug and
  // stored, but it grants nothing: every read still checks the relationship.
  if (parsed.data.selectedChurchSlug !== undefined) {
    if (parsed.data.selectedChurchSlug === null) {
      update.selected_church_id = null;
    } else {
      const slug = churchSlugSchema.parse(parsed.data.selectedChurchSlug);
      const { data: church } = await admin
        .from("churches")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!church) {
        throw new VisitorError("church_not_found", "Church not found.");
      }
      update.selected_church_id = church.id;
    }
  }

  const { data, error } = await admin
    .from("visitor_accounts")
    .update(update)
    .eq("id", account.id)
    .select(ACCOUNT_COLUMNS)
    .maybeSingle();

  if (error || !data) {
    throw new VisitorError("unavailable", "Could not save your profile.");
  }
  return mapAccount(data);
}

/**
 * Consent is recorded with the version it was given against, and withdrawing
 * it is a first-class state rather than an absence. Prompt 6 must treat
 * anything other than `granted` as no.
 */
export async function recordConsent(
  userId: string,
  input: unknown,
): Promise<VisitorAccount> {
  const parsed = consentSchema.safeParse(input);
  if (!parsed.success) {
    throw new VisitorError("invalid_input", "Check the values you entered.");
  }

  const account = await requireActiveAccount(userId);
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const update: Record<string, unknown> = { updated_at: now };

  if (parsed.data.termsVersion) {
    update.terms_version = parsed.data.termsVersion;
    update.terms_accepted_at = now;
  }
  if (parsed.data.privacyVersion) {
    update.privacy_version = parsed.data.privacyVersion;
    update.privacy_accepted_at = now;
  }
  if (parsed.data.autoAttendanceConsent) {
    update.auto_attendance_consent = parsed.data.autoAttendanceConsent;
    update.auto_attendance_consent_at = now;
    update.auto_attendance_consent_version =
      parsed.data.autoAttendanceConsentVersion ?? null;
  }

  const { data, error } = await admin
    .from("visitor_accounts")
    .update(update)
    .eq("id", account.id)
    .select(ACCOUNT_COLUMNS)
    .maybeSingle();

  if (error || !data) {
    throw new VisitorError("unavailable", "Could not save your choice.");
  }

  // Withdrawing consent must reach a device that cached "allowed".
  if (parsed.data.autoAttendanceConsent) {
    await bumpAuthorizationVersion(account.id, admin);
  }

  return mapAccount(data);
}
