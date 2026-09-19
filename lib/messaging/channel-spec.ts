import { chatTeamForChurch } from "@/lib/messaging/ids";
import type { ChannelConfigOverrides, ChannelData } from "@/lib/messaging/provider";
import type { ChurchMessagingSettings } from "@/lib/messaging/settings";

/**
 * What a channel should look like, computed from FaithForm alone.
 *
 * Pure: the reconciler reads the group, the church and its policy, calls
 * these, and makes the provider match. Tested on its own, because every
 * permission a member has in a conversation is decided here.
 */

export type GroupChannelSource = {
  id: string;
  churchId: string;
  churchSlug: string | null;
  name: string;
  coverImageUrl: string | null;
  status: "active" | "archived" | "deleted";
  chatEnabled: boolean;
  chatPosting: "everyone" | "leaders";
  allowMemberMedia: boolean;
  allowMemberLinks: boolean;
  safetyProfile: "standard" | "youth";
};

export const PROFANITY_BLOCKLIST = "profanity_en_2020_v1";

export function groupDeepLink(churchSlug: string, groupId: string): string {
  return `faithform://church/${churchSlug}/groups/${groupId}/chat`;
}

export function dmDeepLink(churchSlug: string, channelId: string): string {
  return `faithform://church/${churchSlug}/messages/${channelId}`;
}

export function groupChannelData(group: GroupChannelSource): ChannelData {
  const custom: Record<string, string> = {
    ff_kind: "group",
    ff_group_id: group.id,
    ff_label: group.name,
    ff_posting: group.chatPosting,
    ff_youth: group.safetyProfile === "youth" ? "1" : "0",
  };
  if (group.churchSlug) {
    custom.ff_church_slug = group.churchSlug;
    custom.ff_deep_link = groupDeepLink(group.churchSlug, group.id);
  }
  return {
    name: group.name,
    image: group.coverImageUrl,
    team: chatTeamForChurch(group.churchId),
    custom,
  };
}

/**
 * Read-only when the group is not active, when its chat is switched off, when
 * the church switched messaging off, or when the church lost Groups. History
 * stays readable to members; nobody can post.
 */
export function groupChannelFrozen(
  group: GroupChannelSource,
  settings: ChurchMessagingSettings,
  groupsFeatureEnabled: boolean,
): boolean {
  return (
    group.status !== "active" ||
    !group.chatEnabled ||
    !settings.messagingEnabled ||
    !groupsFeatureEnabled
  );
}

/**
 * The member permissions a group's settings and its church's policy take
 * away. Leaders (channel moderators) keep everything: a group that allows no
 * photos from members still lets its leader share the flyer.
 */
export function groupChannelOverrides(
  group: GroupChannelSource,
  settings: ChurchMessagingSettings,
): ChannelConfigOverrides {
  const revoked = new Set<string>();

  if (group.chatPosting === "leaders") {
    revoked.add("create-message");
    revoked.add("create-attachment");
    revoked.add("upload-attachment");
  }
  if (!group.allowMemberMedia || !settings.allowMemberMedia) {
    revoked.add("create-attachment");
    revoked.add("upload-attachment");
  }
  if (!group.allowMemberLinks || !settings.allowMemberLinks) {
    revoked.add("add-links");
  }

  return {
    grants: revoked.size > 0 ? { channel_member: [...revoked].sort().map((p) => `!${p}`) } : {},
    commands: settings.allowGifs && group.safetyProfile !== "youth" ? ["giphy"] : [],
    blocklist: settings.profanityFilter ? PROFANITY_BLOCKLIST : null,
  };
}

/** Direct conversations follow the church's media and link policy. */
export function dmChannelOverrides(settings: ChurchMessagingSettings): ChannelConfigOverrides {
  const revoked: string[] = [];
  if (!settings.allowMemberMedia) revoked.push("!create-attachment", "!upload-attachment");
  if (!settings.allowMemberLinks) revoked.push("!add-links");
  return {
    grants: revoked.length > 0 ? { channel_member: revoked.sort() } : {},
    commands: settings.allowGifs ? ["giphy"] : [],
    blocklist: settings.profanityFilter ? PROFANITY_BLOCKLIST : null,
  };
}

export function dmChannelData(input: { churchId: string; churchSlug: string | null; channelId: string }): ChannelData {
  const custom: Record<string, string> = { ff_kind: "direct", ff_label: "Direct message" };
  if (input.churchSlug) {
    custom.ff_church_slug = input.churchSlug;
    custom.ff_deep_link = dmDeepLink(input.churchSlug, input.channelId);
  }
  return { name: "", image: null, team: chatTeamForChurch(input.churchId), custom };
}
