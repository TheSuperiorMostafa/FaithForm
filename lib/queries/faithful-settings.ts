import { createAdminClient } from "@/lib/supabase/admin";

export type ChurchDiscoverySettings = {
  isDiscoverable: boolean;
  publicSummary: string | null;
  joinPolicy: "open" | "approval_required" | "invite_only";
  slug: string | null;
};

const FALLBACK: ChurchDiscoverySettings = {
  isDiscoverable: false,
  publicSummary: null,
  joinPolicy: "approval_required",
  slug: null,
};

/**
 * Reads the church's own discovery configuration for the settings screen.
 *
 * Falls back to "not listed" rather than throwing when migration 0053 has not
 * been applied yet, so an un-migrated environment still renders Settings
 * instead of failing the whole page on a missing column.
 */
export async function getChurchDiscoverySettings(
  churchId: string,
): Promise<ChurchDiscoverySettings> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("churches")
      .select("slug, is_discoverable, public_summary, join_policy")
      .eq("id", churchId)
      .maybeSingle();

    if (error || !data) return FALLBACK;

    return {
      isDiscoverable: Boolean(data.is_discoverable),
      publicSummary: (data.public_summary as string | null) ?? null,
      joinPolicy:
        (data.join_policy as ChurchDiscoverySettings["joinPolicy"]) ??
        "approval_required",
      slug: (data.slug as string | null) ?? null,
    };
  } catch {
    return FALLBACK;
  }
}
