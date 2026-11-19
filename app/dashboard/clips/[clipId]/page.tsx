import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CLIP_EDITOR_DESCRIPTION, CLIP_EDITOR_TITLE } from "@/components/clips/format";
import { ClipEditor } from "@/components/sermon-media/clip-editor";
import { untrimmedSource } from "@/components/sermon-media/api";
import { PageHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { getSermonMediaSettings } from "@/lib/sermon-media/access";
import { getStaffPlayback, getStaffRecording } from "@/lib/stream/recording-publication";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function ClipPage({ params }: { params: Promise<{ clipId: string }> }) {
  if (await pageFeatureBlocked("live_stream")) return null;
  if (await pageFeatureBlocked("sermon_media")) return null;

  const { clipId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(clipId)) notFound();

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");
  const settings = await getSermonMediaSettings(auth.churchId).catch(() => null);
  if (!settings?.enabled) redirect("/dashboard/clips");

  // Church-scoped: a clip from another church is a 404.
  const { data: clip } = await createAdminClient()
    .from("sermon_clips")
    .select("recording_id")
    .eq("id", clipId)
    .eq("church_id", auth.churchId)
    .maybeSingle();
  if (!clip) notFound();
  const recordingId = clip.recording_id as string;

  const [recording, playback] = await Promise.all([
    getStaffRecording(auth.churchId, recordingId),
    getStaffPlayback(auth.churchId, recordingId),
  ]);
  if (!recording) notFound();

  return (
    <div className="flex w-full flex-col gap-8">
      <Link
        href="/dashboard/clips"
        className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to Clips
      </Link>
      <PageHeader title={CLIP_EDITOR_TITLE} description={CLIP_EDITOR_DESCRIPTION} />
      <ClipEditor
        clipId={clipId}
        recordingId={recordingId}
        recordingTitle={recording.title}
        source={untrimmedSource(playback)}
        posterUrl={recording.posterUrl}
        backHref="/dashboard/clips"
        timezone={auth.churchTimezone}
      />
    </div>
  );
}
