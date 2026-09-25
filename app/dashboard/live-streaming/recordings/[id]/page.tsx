import { notFound, redirect } from "next/navigation";

import { AutoRefresh } from "@/components/live-streaming/recordings/auto-refresh";
import { RecordingReview } from "@/components/live-streaming/recordings/recording-review";
import { ItemArtworkPanel } from "@/components/media/item-artwork-panel";
import { getChurchAuth } from "@/lib/auth/church";
import { getMediaItem, getMediaStats, listMediaSeries } from "@/lib/stream/media-library";
import {
  getRecordingSettings,
  getStaffPlayback,
  getStaffRecording,
  listThumbnailChoices,
} from "@/lib/stream/recording-publication";
import { isStillChanging } from "@/lib/stream/recording-status";

export const dynamic = "force-dynamic";

export default async function RecordingReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  // Church-scoped on every read: an id from another church is a 404.
  const recording = await getStaffRecording(auth.churchId, id);
  if (!recording) notFound();

  const [playback, series, thumbnails, settings, mediaItem, stats] = await Promise.all([
    recording.status === "ready" || recording.status === "processing"
      ? getStaffPlayback(auth.churchId, id)
      : Promise.resolve(null),
    listMediaSeries(auth.churchId),
    auth.isAdmin ? listThumbnailChoices(auth.churchId, id) : Promise.resolve([]),
    getRecordingSettings(auth.churchId),
    getMediaItem(auth.churchId, id),
    getMediaStats(auth.churchId, id, recording.sessionId),
  ]);

  const stillChanging = isStillChanging(recording.phase.phase);

  return (
    <>
      <AutoRefresh active={stillChanging} />
      <RecordingReview
        recording={recording}
        playback={playback}
        series={series.map((item) => ({ id: item.id, name: item.name }))}
        thumbnails={thumbnails}
        settings={settings}
        isAdmin={auth.isAdmin}
        timeZone={auth.churchTimezone ?? "America/New_York"}
        stats={{ live: stats.liveViews, replay: stats.replayViews }}
        artworkSlot={
          auth.isAdmin && mediaItem ? (
            <ItemArtworkPanel
              recordingId={mediaItem.id}
              artwork={mediaItem.artwork}
              seriesArtwork={mediaItem.seriesArtwork}
              seriesName={mediaItem.seriesName}
              seriesSlug={mediaItem.seriesSlug}
            />
          ) : null
        }
      />
    </>
  );
}
