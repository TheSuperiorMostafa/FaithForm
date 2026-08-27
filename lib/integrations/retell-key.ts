import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClientOrNull } from "@/lib/supabase/admin";

/**
 * Per-church Retell API key, for a church whose agent was hand-built
 * directly in their own Retell account rather than created by FaithForm.
 *
 * Stored on `church_integrations` (provider `'retell'`, key in
 * `access_token`) the same way Apple Calendar's app-specific password is —
 * service-role only, per the security baseline in migration 0050. This is a
 * dedicated read/write pair rather than a `lib/integrations/tokens.ts` call
 * because that module's `IntegrationProvider` union lives in a file this
 * feature does not touch.
 */
const RETELL_PROVIDER = "retell";

export async function getRetellApiKeyForChurch(
  churchId: string,
  admin?: SupabaseClient,
): Promise<string | null> {
  const client = admin ?? createAdminClientOrNull();
  if (!client) return null;

  const { data, error } = await client
    .from("church_integrations")
    .select("access_token")
    .eq("church_id", churchId)
    .eq("provider", RETELL_PROVIDER)
    .maybeSingle();

  if (error || !data) return null;

  const key = (data.access_token as string | null)?.trim();
  return key || null;
}

export async function hasChurchRetellKey(
  churchId: string,
  admin?: SupabaseClient,
): Promise<boolean> {
  return Boolean(await getRetellApiKeyForChurch(churchId, admin));
}

/** Write-only: the saved key is never handed back to the client afterward. */
export async function saveChurchRetellKey(
  churchId: string,
  apiKey: string,
  admin: SupabaseClient,
): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error("Retell API key is required.");
  }

  const { error } = await admin.from("church_integrations").upsert(
    {
      church_id: churchId,
      provider: RETELL_PROVIDER,
      access_token: trimmed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "church_id,provider" },
  );

  if (error) {
    throw new Error("Could not save the Retell API key.");
  }
}
