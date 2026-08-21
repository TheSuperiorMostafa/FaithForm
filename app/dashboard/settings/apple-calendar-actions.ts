"use server";

import { revalidatePath } from "next/cache";

import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import {
  discoverAppleCalendars,
  listAppleCalendarEventsInRange,
  type AppleCalendarChoice,
} from "@/lib/integrations/apple-calendar";
import { CalDavAuthError, CalDavError } from "@/lib/integrations/caldav";
import {
  clearReconnectFlags,
  getIntegration,
  saveIntegration,
} from "@/lib/integrations/tokens";
import type { AppleIntegrationMetadata } from "@/lib/integrations/types";
import { createClient } from "@/lib/supabase/server";

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

function failureMessage(err: unknown): string {
  if (err instanceof CalDavAuthError) {
    return "Apple would not accept that. Check the Apple ID, and make sure the password is an app-specific password generated at account.apple.com — not the Apple ID's own password.";
  }
  if (err instanceof CalDavError) return err.message;
  return "Could not reach iCloud. Try again in a moment.";
}

type ChurchAuth = NonNullable<Awaited<ReturnType<typeof getChurchAuth>>>;

type Gate =
  | { ok: true; auth: ChurchAuth; supabase: ReturnType<typeof createClient> }
  | { ok: false; error: string };

async function requireAnnouncementsAdmin(): Promise<Gate> {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);

  if (!auth) return { ok: false, error: "No church linked" };
  if (!auth.isAdmin) {
    return { ok: false, error: "Only church admins can change integrations." };
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
    return { ok: false, error: failureMessage(err) };
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

    const existing = await getIntegration(auth.churchId, "apple", supabase);
    const metadata: AppleIntegrationMetadata = {
      ...clearReconnectFlags(existing?.metadata),
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

    // Prove the saved connection can actually read events before telling the
    // church it is connected.
    const now = new Date();
    await listAppleCalendarEventsInRange(
      auth.churchId,
      now.toISOString(),
      new Date(now.getTime() + 7 * 86_400_000).toISOString(),
      supabase,
    );

    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/announcements");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: failureMessage(err) };
  }
}
