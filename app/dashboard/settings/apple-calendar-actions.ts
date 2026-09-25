"use server";

import { revalidatePath } from "next/cache";

import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import {
  discoverAppleCalendars,
  inspectAppleCalendarLink,
  verifyAppleCalendarReadable,
  type AppleCalendarChoice,
} from "@/lib/integrations/apple-calendar";
import { ICloudMailError, verifyICloudMailDrafts } from "@/lib/integrations/icloud-mail";
import { CalendarFeedError } from "@/lib/integrations/apple-feed";
import { CalDavAuthError, CalDavError } from "@/lib/integrations/caldav";
import {
  clearReconnectFlags,
  getIntegration,
  saveIntegration,
} from "@/lib/integrations/tokens";
import type { AppleIntegrationMetadata } from "@/lib/integrations/types";
import { createClient } from "@/lib/supabase/server";
import { toUserError } from "@/lib/errors/user-error";

/**
 * Connecting iCloud Calendar.
 *
 * Two steps rather than one, because a church usually keeps several calendars
 * on one Apple ID and only one of them is the church's: the first call proves
 * the credentials and lists what is there, the second saves the choice.
 */

export type AppleConnectState =
  | { ok: true; calendars: AppleCalendarChoice[] }
  | { ok: false; error: string };

export type AppleSaveState = { ok: true } | { ok: false; error: string };

function failureMessage(err: unknown, step: "list" | "save"): string {
  if (err instanceof CalDavAuthError) {
    return "Apple would not accept that. Check the Apple ID, and make sure the password is an app-specific password generated at account.apple.com, not the Apple ID's own password.";
  }
  if (err instanceof CalDavError) return err.message;

  // Anything that is not a CalDAV error happened on our side, not Apple's.
  // It used to be reported as "Could not reach iCloud", which sent people off
  // to retry a login that had already worked.
  console.error(`[apple-calendar] ${step} failed:`, err);
  return step === "save"
    ? "Apple accepted the login, but FaithForm could not save the connection. Try again, and contact support if it keeps happening."
    : "Something went wrong on our side while talking to iCloud. Try again in a moment.";
}

type ChurchAuth = NonNullable<Awaited<ReturnType<typeof getChurchAuth>>>;

type Gate =
  | { ok: true; auth: ChurchAuth; supabase: ReturnType<typeof createClient> }
  | { ok: false; error: string };

async function requireAnnouncementsAdmin(): Promise<Gate> {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);

  if (!auth) return { ok: false, error: "Your account isn't connected to a church yet." };
  if (!auth.isAdmin) {
    return { ok: false, error: "Only church admins can change connected accounts." };
  }
  const denied = await featureActionError("announcements", supabase);
  if (denied) return { ok: false, error: denied };

  return { ok: true, auth, supabase };
}

export async function listAppleCalendarsAction(
  formData: FormData,
): Promise<AppleConnectState> {
  const gate = await requireAnnouncementsAdmin();
  if (!gate.ok) return gate;

  const appleId = formData.get("appleId")?.toString().trim().toLowerCase() ?? "";
  // Apple prints app-specific passwords in groups of four; people paste them
  // with the dashes and spaces intact, and Apple wants neither.
  const password = (formData.get("appPassword")?.toString() ?? "").replace(
    /[\s-]/g,
    "",
  );

  if (!appleId || !password) {
    return { ok: false, error: "Apple ID and app-specific password are both required." };
  }

  try {
    const discovery = await discoverAppleCalendars({
      username: appleId,
      password,
    });
    return { ok: true, calendars: discovery.calendars };
  } catch (err) {
    return { ok: false, error: failureMessage(err, "list") };
  }
}

export async function connectAppleCalendarAction(
  formData: FormData,
): Promise<AppleSaveState> {
  const gate = await requireAnnouncementsAdmin();
  if (!gate.ok) return gate;
  const { auth, supabase } = gate;

  const appleId = formData.get("appleId")?.toString().trim().toLowerCase() ?? "";
  const password = (formData.get("appPassword")?.toString() ?? "").replace(
    /[\s-]/g,
    "",
  );
  const calendarUrl = formData.get("calendarUrl")?.toString().trim() ?? "";
  const calendarName = formData.get("calendarName")?.toString().trim() ?? "";

  if (!appleId || !password || !calendarUrl) {
    return { ok: false, error: "Pick a calendar to connect." };
  }

  try {
    // Re-run discovery so the chosen calendar is one Apple actually returned
    // for these credentials, rather than whatever the browser posted back.
    const discovery = await discoverAppleCalendars({
      username: appleId,
      password,
    });
    const chosen = discovery.calendars.find(
      (calendar) => calendar.url === calendarUrl,
    );
    if (!chosen) {
      return { ok: false, error: "That calendar is no longer on this Apple ID." };
    }

    // Prove these credentials can read events from this calendar before
    // anything is stored, so a failure leaves nothing half-connected behind.
    await verifyAppleCalendarReadable({ username: appleId, password }, chosen.url);

    const existing = await getIntegration(auth.churchId, "apple", supabase);
    const metadata: AppleIntegrationMetadata = {
      ...clearReconnectFlags(existing?.metadata),
      // Stated outright: an earlier link connection leaves `public_link` here.
      mode: "caldav",
      apple_id: appleId,
      calendar_url: chosen.url,
      calendar_name: calendarName || chosen.name,
      calendar_home_url: discovery.calendarHomeUrl,
      connected_at: new Date().toISOString(),
    };

    await saveIntegration(
      {
        churchId: auth.churchId,
        provider: "apple",
        accessToken: password,
        // CalDAV has nothing to refresh: the app-specific password is the
        // credential, and it lasts until the church revokes it in Apple.
        refreshToken: null,
        tokenExpiresAt: null,
        metadata: metadata as Record<string, unknown>,
        connectedBy: auth.userId,
      },
      supabase,
    );

    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/announcements");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: failureMessage(err, "save") };
  }
}

/**
 * Connecting iCloud with the calendar's public link: no Apple ID, no password.
 *
 * The link is read once before saving, so a church learns right away if it
 * pasted the wrong thing, and so the calendar can be shown by its own name.
 * It replaces any earlier iCloud connection rather than sitting beside one.
 */
export async function connectAppleCalendarLinkAction(
  formData: FormData,
): Promise<AppleSaveState> {
  const gate = await requireAnnouncementsAdmin();
  if (!gate.ok) return gate;
  const { auth, supabase } = gate;

  const pasted = formData.get("calendarLink")?.toString() ?? "";
  if (!pasted.trim()) {
    return { ok: false, error: "Paste the calendar link from Apple Calendar first." };
  }

  let inspected: Awaited<ReturnType<typeof inspectAppleCalendarLink>>;
  try {
    inspected = await inspectAppleCalendarLink(pasted);
  } catch (err) {
    if (err instanceof CalendarFeedError) return { ok: false, error: err.message };
    console.error("[apple-calendar] link check failed:", err);
    return {
      ok: false,
      error: "Something went wrong on our side while reading that link. Try again in a moment.",
    };
  }

  const metadata: AppleIntegrationMetadata = {
    mode: "public_link",
    calendar_name: inspected.calendarName ?? "iCloud calendar",
    connected_at: new Date().toISOString(),
  };

  try {
    await saveIntegration(
      {
        churchId: auth.churchId,
        provider: "apple",
        // The link is the key to the calendar, so it is kept where keys are
        // kept: never in metadata, which the status projection hands out.
        accessToken: inspected.feedUrl,
        refreshToken: null,
        tokenExpiresAt: null,
        metadata: metadata as Record<string, unknown>,
        connectedBy: auth.userId,
      },
      supabase,
    );
  } catch (err) {
    console.error("[apple-calendar] link save failed:", err);
    return {
      ok: false,
      error: "The link works, but FaithForm could not save it. Try again, and contact support if it keeps happening.",
    };
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/announcements");
  return { ok: true };
}

/** Enables iCloud Mail drafts using the same app-specific password as Calendar. */
export async function configureICloudMailAction(
  formData: FormData,
): Promise<AppleSaveState> {
  const gate = await requireAnnouncementsAdmin();
  if (!gate.ok) return gate;
  const { auth, supabase } = gate;
  const enabled = formData.get("enabled") === "true";
  const address = formData.get("mailAddress")?.toString().trim().toLowerCase() ?? "";
  const existing = await getIntegration(auth.churchId, "apple", supabase);
  const metadata = (existing?.metadata ?? {}) as AppleIntegrationMetadata;

  if (!existing || metadata.mode === "public_link" || !existing.access_token?.trim()) {
    return { ok: false, error: "Connect iCloud with an Apple ID before turning on Apple Mail drafts." };
  }
  if (!enabled) {
    await saveIntegration({
      churchId: auth.churchId,
      provider: "apple",
      accessToken: existing.access_token,
      refreshToken: existing.refresh_token,
      tokenExpiresAt: existing.token_expires_at ? new Date(existing.token_expires_at) : null,
      metadata: { ...metadata, mail_enabled: false, mail_verified_at: undefined },
      connectedBy: auth.userId,
    }, supabase);
    revalidatePath("/dashboard/settings");
    return { ok: true };
  }
  if (!address) return { ok: false, error: "Enter the iCloud Mail address first." };

  try {
    await verifyICloudMailDrafts({ address, password: existing.access_token });
  } catch (err) {
    // These messages are written for churches (see lib/integrations/icloud-mail.ts).
    if (err instanceof ICloudMailError) return { ok: false, error: err.message };
    return { ok: false, error: toUserError(err, "We couldn't check that iCloud Mail address.") };
  }

  await saveIntegration({
    churchId: auth.churchId,
    provider: "apple",
    accessToken: existing.access_token,
    refreshToken: existing.refresh_token,
    tokenExpiresAt: existing.token_expires_at ? new Date(existing.token_expires_at) : null,
    metadata: {
      ...metadata,
      mail_address: address,
      mail_enabled: true,
      mail_verified_at: new Date().toISOString(),
    },
    connectedBy: auth.userId,
  }, supabase);
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/announcements");
  return { ok: true };
}
