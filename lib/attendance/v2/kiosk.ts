import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Kiosk credentials.
 *
 * A kiosk is a restricted machine identity bound to one church and optionally
 * one campus. It is deliberately weak: it may submit an attendance attempt for
 * a person the *server* resolved, and nothing else. It confers no staff role,
 * no service-role authority, and no ability to read People.
 *
 * Only the hash is stored, so a leaked backup does not yield a working kiosk.
 */

const CREDENTIAL_BYTES = 32;

export function generateKioskCredential(): string {
  return randomBytes(CREDENTIAL_BYTES).toString("base64url");
}

export function hashKioskCredential(credential: string): string {
  return createHash("sha256").update(credential, "utf8").digest("hex");
}

export function kioskHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type KioskContext = {
  credentialId: string;
  churchId: string;
  campusId: string | null;
};

/**
 * Resolves a presented credential.
 *
 * Refuses a revoked, disabled, or expired credential. Touching `last_used_at`
 * is what makes the stale-credential cleanup job possible.
 */
export async function resolveKiosk(
  credential: string,
  client?: SupabaseClient,
): Promise<KioskContext | null> {
  if (!credential || credential.length < 16) return null;

  const admin = client ?? createAdminClient();
  const { data } = await admin
    .from("attendance_kiosk_credentials")
    .select("id, church_id, campus_id, is_enabled, expires_at, revoked_at")
    .eq("credential_hash", hashKioskCredential(credential))
    .maybeSingle();

  if (!data) return null;
  if (!data.is_enabled || data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at as string) <= new Date()) return null;

  await admin
    .from("attendance_kiosk_credentials")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id as string);

  return {
    credentialId: data.id as string,
    churchId: data.church_id as string,
    campusId: (data.campus_id as string | null) ?? null,
  };
}

/** Issues a credential. The raw value is returned once and never stored. */
export async function issueKioskCredential(input: {
  churchId: string;
  campusId?: string | null;
  label: string;
  actorUserId: string;
  expiresAt?: string | null;
  client?: SupabaseClient;
}): Promise<{ id: string; credential: string } | null> {
  const admin = input.client ?? createAdminClient();
  const credential = generateKioskCredential();

  const { data, error } = await admin
    .from("attendance_kiosk_credentials")
    .insert({
      church_id: input.churchId,
      campus_id: input.campusId ?? null,
      label: input.label.slice(0, 120),
      credential_hash: hashKioskCredential(credential),
      expires_at: input.expiresAt ?? null,
      created_by: input.actorUserId,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) return null;
  return { id: data.id as string, credential };
}

export async function revokeKioskCredential(input: {
  churchId: string;
  credentialId: string;
  actorUserId: string;
  client?: SupabaseClient;
}): Promise<void> {
  const admin = input.client ?? createAdminClient();
  await admin
    .from("attendance_kiosk_credentials")
    .update({
      is_enabled: false,
      revoked_at: new Date().toISOString(),
      revoked_by: input.actorUserId,
    })
    .eq("id", input.credentialId)
    // Exact tenant predicate: a credential id from another church matches
    // nothing rather than being revoked by a guess.
    .eq("church_id", input.churchId);
}
