import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ClipEditor } from "@/components/sermon-media/clip-editor";
import { untrimmedSource } from "@/components/sermon-media/api";
import { PageHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { getSermonMediaSettings } from "@/lib/sermon-media/access";
import { getStaffPlayback, getStaffRecording } from "@/lib/stream/recording-publication";

export const dynamic = "force-dynamic";

const CLIP_PAGE_TITLE = "Edit clip";
const CLIP_PAGE_DESCRIPTION =
  "Choose the moment, check the captions and make the final video. Then post it to Facebook.";

export default async function ClipEditorPage({ params }: { params: Promise<{ id: string; clipId: string }> }) {
  if (await pageFeatureBlocked("live_stream")) return null;

  const { id, clipId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(clipId)) notFound();

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  // Church-scoped: a recording from another church is a 404.
  const recording = await getStaffRecording(auth.churchId, id);
  if (!recording) notFound();
  const settings = await getSermonMediaSettings(auth.churchId).catch(() => null);
  if (!settings?.enabled) notFound();

  const playback = await getStaffPlayback(auth.churchId, id);

  return (
    <div className="flex w-full flex-col gap-8">
      <Link
        href={`/dashboard/live-streaming/recordings/${id}`}
        className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to the recording
      </Link>
      <PageHeader title={CLIP_PAGE_TITLE} description={CLIP_PAGE_DESCRIPTION} />
      <ClipEditor
        clipId={clipId}
        recordingId={id}
        recordingTitle={recording.title}
        source={untrimmedSource(playback)}
        posterUrl={recording.posterUrl}
      />
    </div>
  );
}
