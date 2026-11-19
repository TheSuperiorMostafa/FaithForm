import "server-only";

import { NextResponse } from "next/server";

import { getChurchAuth, type ChurchAuth } from "@/lib/auth/church";
import { isChurchFeatureEnabled } from "@/lib/features/access";
import { featureAccessDenied } from "@/lib/features/guard";
import type { PostSchedule } from "@/lib/sermon-media/schedule";
import { settingsFromRow } from "@/lib/sermon-media/settings";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server authorization for sermon media. Every table is service-role only, so
 * these checks are the access control: the caller is signed-in staff of the
 * church, has the feature, the church has the rollout on, and the recording is
 * the church's own and not deleted. RLS denies everything to browsers on top.
 */
export type SermonMediaSettings = {
  enabled: boolean;
  autoTranscribe: boolean;
  language: string;
  maxConcurrentJobs: number;
  autoConfirmRange: boolean;
  autoClips: boolean;
  clipsPerService: number;
  postSchedule: PostSchedule;
};

export function sermonMediaGloballyEnabled(): boolean {
  return process.env.SERMON_MEDIA_ENABLED === "1";
}

const SETTINGS_COLUMNS =
  "auto_transcribe, language, max_concurrent_jobs, auto_confirm_range, auto_clips, clips_per_service, post_schedule";

export { settingsFromRow };

export async function getSermonMediaSettings(churchId: string): Promise<SermonMediaSettings> {
  const disabled: SermonMediaSettings = { enabled: false, ...settingsFromRow(null), autoTranscribe: false, autoClips: false };
  if (!sermonMediaGloballyEnabled()) return disabled;
  // The church's "Transcripts & Clips" feature switch (off until a platform
  // admin turns it on) decides whether the church has it at all. The settings
  // row is optional and only tunes it: automation, language, caps, schedule.
  if (!(await isChurchFeatureEnabled(churchId, "sermon_media"))) return disabled;
  const { data } = await createAdminClient()
    .from("sermon_media_settings")
    .select(SETTINGS_COLUMNS)
    .eq("church_id", churchId)
    .maybeSingle();
  return { enabled: true, ...settingsFromRow((data as Record<string, unknown> | null) ?? null) };
}

export type RecordingAccess = {
  auth: ChurchAuth;
  recording: {
    id: string;
    churchId: string;
    title: string | null;
    status: string;
    sourceKind: "file" | "segments";
    durationSec: number | null;
    createdAt: string;
  };
  settings: SermonMediaSettings;
};

type Denied = { ok: false; response: NextResponse };
type Allowed = { ok: true; access: RecordingAccess };

const deny = (status: number, error: string): Denied => ({
  ok: false,
  response: NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } }),
});

/**
 * @param need "view" — read transcript, range, clips; "edit" — change them or
 *   start work; "publish" — post to Facebook (church admins only, matching who
 *   may connect the Page).
 */
export async function requireRecordingAccess(
  recordingId: string,
  need: "view" | "edit" | "publish",
): Promise<Allowed | Denied> {
  if (!/^[0-9a-f-]{36}$/i.test(recordingId)) return deny(404, "We couldn't find that recording.");
  const auth = await getChurchAuth();
  if (!auth) return deny(401, "Please sign in again.");
  const featureDenied = await featureAccessDenied("live_stream");
  if (featureDenied) return { ok: false, response: featureDenied };
  const mediaDenied = await featureAccessDenied("sermon_media");
  if (mediaDenied) return { ok: false, response: mediaDenied };
  if (need === "publish" && !auth.isAdmin) {
    return deny(403, "Only a church administrator can post to Facebook.");
  }

  const settings = await getSermonMediaSettings(auth.churchId);
  if (!settings.enabled) return deny(403, "Sermon transcripts aren't turned on for your church yet.");

  const { data, error } = await createAdminClient()
    .from("stream_recordings")
    .select("id, church_id, title, status, source_kind, duration_sec, created_at, deleted_at")
    .eq("id", recordingId)
    .eq("church_id", auth.churchId)
    .maybeSingle();
  if (error || !data || data.deleted_at) return deny(404, "We couldn't find that recording.");

  return {
    ok: true,
    access: {
      auth,
      settings,
      recording: {
        id: data.id,
        churchId: data.church_id,
        title: data.title,
        status: data.status,
        sourceKind: data.source_kind === "file" ? "file" : "segments",
        durationSec: data.duration_sec === null ? null : Number(data.duration_sec),
        createdAt: data.created_at,
      },
    },
  };
}

export type StudioAccess = { auth: ChurchAuth; settings: SermonMediaSettings };

/** Access to the Transcripts and Clips sections (not tied to one recording). */
export async function requireStudioAccess(
  need: "view" | "edit" | "admin",
): Promise<{ ok: true; access: StudioAccess } | Denied> {
  const auth = await getChurchAuth();
  if (!auth) return deny(401, "Please sign in again.");
  const liveDenied = await featureAccessDenied("live_stream");
  if (liveDenied) return { ok: false, response: liveDenied };
  const mediaDenied = await featureAccessDenied("sermon_media");
  if (mediaDenied) return { ok: false, response: mediaDenied };
  if (need === "admin" && !auth.isAdmin) return deny(403, "Only a church administrator can change this.");
  const settings = await getSermonMediaSettings(auth.churchId);
  if (!settings.enabled) return deny(403, "Transcripts & Clips isn't turned on for your church yet.");
  return { ok: true, access: { auth, settings } };
}
