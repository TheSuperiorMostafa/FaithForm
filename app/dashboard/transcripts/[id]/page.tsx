import { notFound, redirect } from "next/navigation";

import { AutoRefresh } from "@/components/live-streaming/recordings/auto-refresh";
import { untrimmedSource, type PublicJob, type SermonMediaState } from "@/components/sermon-media/api";
import { TranscriptDetail } from "@/components/transcripts/transcript-detail";
import { TranscriptsSettingUp } from "@/components/transcripts/transcripts-setting-up";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { getSermonMediaSettings } from "@/lib/sermon-media/access";
import { getLatestJob, getSermonMediaState, publicJob } from "@/lib/sermon-media/store";
import { formatRecordingDate } from "@/lib/stream/recording-date";
import { getStaffPlayback, getStaffRecording } from "@/lib/stream/recording-publication";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function TranscriptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  if (await pageFeatureBlocked("live_stream")) return null;
  if (await pageFeatureBlocked("sermon_media")) return null;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const settings = await getSermonMediaSettings(auth.churchId).catch(() => null);
  if (!settings?.enabled) return <TranscriptsSettingUp />;

  // Church-scoped on every read: a recording from another church is a 404.
  const recording = await getStaffRecording(auth.churchId, id);
  if (!recording) notFound();

  const db = createAdminClient();
  const [playback, state, job] = await Promise.all([
    ["ready", "published", "processing"].includes(recording.status)
      ? getStaffPlayback(auth.churchId, id)
      : Promise.resolve(null),
    getSermonMediaState(db, auth.churchId, id),
    getLatestJob(db, auth.churchId, id, "transcribe"),
  ]);

  // `?t=<seconds>` from a lesson: open the transcript at that moment.
  const rawT = (await searchParams).t;
  const parsedT = Number(Array.isArray(rawT) ? rawT[0] : rawT);
  const initialSeekSec = Number.isFinite(parsedT) && parsedT >= 0 ? parsedT : null;

  const timeZone = auth.churchTimezone || "America/New_York";
  const durationSec = recording.fullDurationSec ?? recording.durationSec;

  return (
    <>
      {/* The video is still being prepared: pick up its new state (and the player) when it's ready. */}
      <AutoRefresh active={recording.status === "processing"} />
      <TranscriptDetail
        recording={{
          id,
          title: recording.title || "Untitled service",
          dateLabel: formatRecordingDate(recording.recordedAt, timeZone, recording.serviceDate, true),
          source: recording.sourceKind === "file" ? "upload" : "livestream",
          status: recording.status,
          durationSec,
          posterUrl: recording.posterUrl,
        }}
        source={untrimmedSource(playback)}
        initialState={state as SermonMediaState}
        initialJob={publicJob(job, durationSec ?? 0) as PublicJob | null}
        currentUserId={auth.userId}
        initialSeekSec={initialSeekSec}
        autoTranscribe={settings.autoTranscribe}
      />
    </>
  );
}
