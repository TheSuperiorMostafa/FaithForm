import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { DM_POLICIES, type DmPolicy } from "@/lib/messaging/dm-policy";

/**
 * A church's messaging policy. An absent row means these defaults — which is
 * why the defaults live in exactly one place and match the migration's.
 */

export type ChurchMessagingSettings = {
  messagingEnabled: boolean;
  dmPolicy: DmPolicy;
  allowMemberMedia: boolean;
  allowMemberLinks: boolean;
  allowGifs: boolean;
  profanityFilter: boolean;
  updatedAt: string | null;
};

export const DEFAULT_MESSAGING_SETTINGS: ChurchMessagingSettings = {
  messagingEnabled: true,
  dmPolicy: "disabled",
  allowMemberMedia: true,
  allowMemberLinks: true,
  allowGifs: false,
  profanityFilter: true,
  updatedAt: null,
};

export const messagingSettingsSchema = z.object({
  messagingEnabled: z.boolean(),
  dmPolicy: z.enum(DM_POLICIES),
  allowMemberMedia: z.boolean(),
  allowMemberLinks: z.boolean(),
  allowGifs: z.boolean(),
  profanityFilter: z.boolean(),
});

const COLUMNS =
  "messaging_enabled, dm_policy, allow_member_media, allow_member_links, allow_gifs, profanity_filter, updated_at";

function map(row: Record<string, unknown> | null): ChurchMessagingSettings {
  if (!row) return { ...DEFAULT_MESSAGING_SETTINGS };
  const policy = row.dm_policy as DmPolicy;
  return {
    messagingEnabled: row.messaging_enabled !== false,
    dmPolicy: (DM_POLICIES as readonly string[]).includes(policy) ? policy : "disabled",
    allowMemberMedia: row.allow_member_media !== false,
    allowMemberLinks: row.allow_member_links !== false,
    allowGifs: row.allow_gifs === true,
    profanityFilter: row.profanity_filter !== false,
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

export async function getChurchMessagingSettings(
  admin: SupabaseClient,
  churchId: string,
): Promise<ChurchMessagingSettings> {
  const { data, error } = await admin
    .from("church_messaging_settings")
    .select(COLUMNS)
    .eq("church_id", churchId)
    .maybeSingle();
  // A read failure must not widen anything: the defaults are the closed ones
  // for direct messages, and group chat is governed by the group itself.
  if (error) return { ...DEFAULT_MESSAGING_SETTINGS, dmPolicy: "disabled" };
  return map(data as Record<string, unknown> | null);
}

export async function saveChurchMessagingSettings(
  admin: SupabaseClient,
  churchId: string,
  actorUserId: string,
  values: unknown,
): Promise<ChurchMessagingSettings> {
  const parsed = messagingSettingsSchema.parse(values);
  const { data, error } = await admin
    .from("church_messaging_settings")
    .upsert(
      {
        church_id: churchId,
        messaging_enabled: parsed.messagingEnabled,
        dm_policy: parsed.dmPolicy,
        allow_member_media: parsed.allowMemberMedia,
        allow_member_links: parsed.allowMemberLinks,
        allow_gifs: parsed.allowGifs,
        profanity_filter: parsed.profanityFilter,
        updated_by: actorUserId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "church_id" },
    )
    .select(COLUMNS)
    .single();
  if (error || !data) throw new Error("Could not save messaging settings.");
  return map(data as Record<string, unknown>);
}
