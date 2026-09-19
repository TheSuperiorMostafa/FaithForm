import type { SupabaseClient } from "@supabase/supabase-js";

import { isChurchFeatureEmailEnabled } from "@/lib/features/access";
import { createGmailDraft, GMAIL_DRAFTS_URL } from "@/lib/integrations/gmail";
import {
  createICloudMailDraft,
  ICLOUD_DRAFT_ID_PREFIX,
  ICLOUD_MAIL_URL,
  icloudMailOptedIn,
  icloudMailReady,
} from "@/lib/integrations/icloud-mail";
import type { MailMessageInput } from "@/lib/integrations/mime-message";
import { getIntegration, hasIntegration } from "@/lib/integrations/tokens";
import type { AppleIntegrationMetadata } from "@/lib/integrations/types";

/**
 * Where the weekly announcement email gets made.
 *
 * FaithForm never sends the weekly email. It leaves one finished draft in the
 * church's own mailbox, and the pastor reviews and sends it from there. That
 * mailbox is Gmail when Google is connected, or iCloud Mail when the church
 * connected iCloud with an Apple ID and turned iCloud Mail on.
 */

export type WeeklyEmailChannel = "gmail" | "icloud";

export type WeeklyEmailConnections = {
  googleConnected: boolean;
  /** The iCloud connection, if there is one. The password itself stays out. */
  apple: { hasPassword: boolean; metadata: AppleIntegrationMetadata } | null;
};

/**
 * Google comes first. It was the only way to get the email before iCloud
 * Mail, and a church that has both keeps getting it where it always has.
 */
export function pickWeeklyEmailChannel(
  connections: WeeklyEmailConnections,
): WeeklyEmailChannel | null {
  if (connections.googleConnected) return "gmail";
  if (connections.apple && icloudMailReady(connections.apple)) return "icloud";
  return null;
}

async function loadWeeklyEmailConnections(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<WeeklyEmailConnections> {
  const [googleConnected, apple] = await Promise.all([
    hasIntegration(churchId, "google", supabase),
    getIntegration(churchId, "apple", supabase),
  ]);

  return {
    googleConnected,
    apple: apple
      ? {
          hasPassword: Boolean(apple.access_token?.trim()),
          metadata: (apple.metadata ?? {}) as AppleIntegrationMetadata,
        }
      : null,
  };
}

/** Which mailbox this church's weekly email would be made in, if any. */
export async function resolveWeeklyEmailChannel(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<WeeklyEmailChannel | null> {
  return pickWeeklyEmailChannel(
    await loadWeeklyEmailConnections(churchId, supabase),
  );
}

export type WeeklyEmailAvailability = {
  channel: WeeklyEmailChannel | null;
  /** A platform admin switched this church's announcement email off. */
  switchedOff: boolean;
  /** There is a mailbox to make the email in, and it may be made. */
  available: boolean;
};

export async function getWeeklyEmailAvailability(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<WeeklyEmailAvailability> {
  const [channel, emailOn] = await Promise.all([
    resolveWeeklyEmailChannel(churchId, supabase),
    isChurchFeatureEmailEnabled(churchId, "announcements"),
  ]);

  return {
    channel,
    switchedOff: !emailOn,
    available: channel !== null && emailOn,
  };
}

/**
 * "Can this church get a weekly email?" for the screens that offer to put an
 * event in it. False when there is no mailbox, and when the email is off.
 */
export async function isWeeklyEmailAvailable(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<boolean> {
  return (await getWeeklyEmailAvailability(churchId, supabase)).available;
}

/** Said wherever the email is refused because a platform admin switched it off. */
export const WEEKLY_EMAIL_SWITCHED_OFF_MESSAGE =
  "Announcement emails are switched off for your church. Contact FaithForm support if you'd like them back on.";

/** Said wherever there is no mailbox to make the email in. */
export const NO_WEEKLY_EMAIL_CHANNEL_MESSAGE =
  "There's nowhere to create the weekly email yet. In Settings, under Integrations, connect Google, or connect iCloud with an Apple ID and turn on iCloud Mail.";

/**
 * Which mailbox made a draft, from the id stored for it. iCloud ids carry a
 * prefix; anything else is a Gmail id, which is all there were before.
 */
export function weeklyEmailChannelFromDraftId(
  draftId: string | null | undefined,
): WeeklyEmailChannel | null {
  if (!draftId) return null;
  return draftId.startsWith(ICLOUD_DRAFT_ID_PREFIX) ? "icloud" : "gmail";
}

/** A button to the church's drafts, named for the mailbox they are in. */
export type WeeklyEmailDraftLink = {
  provider: WeeklyEmailChannel;
  href: string;
  label: string;
};

const DRAFT_LINKS: Record<WeeklyEmailChannel, WeeklyEmailDraftLink> = {
  gmail: { provider: "gmail", href: GMAIL_DRAFTS_URL, label: "Open email drafts" },
  icloud: { provider: "icloud", href: ICLOUD_MAIL_URL, label: "Open iCloud Mail" },
};

export function weeklyEmailDraftLink(
  channel: WeeklyEmailChannel,
): WeeklyEmailDraftLink {
  return DRAFT_LINKS[channel];
}

/**
 * The drafts link to show this week: the mailbox this week's draft was made
 * in, or, before there is one, the mailbox it would be made in.
 */
export function weeklyEmailDraftLinkFor(input: {
  draftIdThisWeek: string | null | undefined;
  channel: WeeklyEmailChannel | null;
}): WeeklyEmailDraftLink | null {
  const provider =
    weeklyEmailChannelFromDraftId(input.draftIdThisWeek) ?? input.channel;
  return provider ? weeklyEmailDraftLink(provider) : null;
}

/** One `church_integrations` row, without its tokens. */
export type IntegrationSummary = {
  churchId: string;
  provider: string;
  metadata: Record<string, unknown> | null;
};

/**
 * The churches the Monday run should try.
 *
 * Every church with a Google row, as before. A broken one is still tried, so
 * it shows up in the run's errors rather than quietly dropping out. Then
 * every church that turned iCloud Mail on. An iCloud calendar on its own is
 * not a request for email.
 */
export function selectWeeklyDraftChurchIds(rows: IntegrationSummary[]): string[] {
  const churchIds = new Set<string>();

  for (const row of rows) {
    if (!row.churchId) continue;
    if (row.provider === "google") {
      churchIds.add(row.churchId);
    } else if (
      row.provider === "apple" &&
      icloudMailOptedIn(row.metadata as AppleIntegrationMetadata | null)
    ) {
      churchIds.add(row.churchId);
    }
  }

  return Array.from(churchIds);
}

/** Makes the draft in the given mailbox. */
export async function createWeeklyEmailDraft(
  channel: WeeklyEmailChannel,
  churchId: string,
  message: MailMessageInput,
  supabase?: SupabaseClient,
): Promise<{ draftId: string; draftUrl: string }> {
  return channel === "icloud"
    ? createICloudMailDraft(churchId, message, supabase)
    : createGmailDraft(churchId, message, supabase);
}
