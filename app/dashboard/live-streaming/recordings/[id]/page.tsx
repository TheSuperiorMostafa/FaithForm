import { notFound, redirect } from "next/navigation";

import { AutoRefresh } from "@/components/live-streaming/recordings/auto-refresh";
import { RecordingReview } from "@/components/live-streaming/recordings/recording-review";
import { ItemArtworkPanel } from "@/components/media/item-artwork-panel";
import { SermonMediaPanel } from "@/components/sermon-media/sermon-media-panel";
import { getChurchAuth } from "@/lib/auth/church";
import { getFeatureAccess } from "@/lib/features/access";
import { getMediaItem, getMediaStats, listMediaSeries, listMediaTagSuggestions } from "@/lib/stream/media-library";
import {
  getRecordingSettings,
  getStaffPlayback,
  getStaffRecording,
  listThumbnailChoices,
  getWebsiteSermonsUrl,
} from "@/lib/stream/recording-publication";
import { isStillChanging } from "@/lib/stream/recording-status";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { getSermonMediaSettings } from "@/lib/sermon-media/access";

export const dynamic = "force-dynamic";

export default async function RecordingReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  if (await pageFeatureBlocked("live_stream")) return null;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  // Church-scoped on every read: an id from another church is a 404.
  const recording = await getStaffRecording(auth.churchId, id);
  if (!recording) notFound();

  const [playback, series, thumbnails, settings, mediaItem, stats, access, websiteSermonsUrl, tagSuggestions, sermonMedia] = await Promise.all([
    recording.status === "ready" || recording.status === "processing"
      ? getStaffPlayback(auth.churchId, id)
      : Promise.resolve(null),
    listMediaSeries(auth.churchId),
    auth.isAdmin ? listThumbnailChoices(auth.churchId, id) : Promise.resolve([]),
    getRecordingSettings(auth.churchId),
    getMediaItem(auth.churchId, id),
    getMediaStats(auth.churchId, id, recording.sessionId),
    getFeatureAccess(),
    getWebsiteSermonsUrl(auth.churchId),
    listMediaTagSuggestions(auth.churchId),
    getSermonMediaSettings(auth.churchId).catch(() => null),
  ]);

  const stillChanging = isStillChanging(recording.phase.phase);

  // `?t=<seconds>#transcript` from a lesson: open the transcript at that moment.
  const rawT = (await searchParams).t;
  const parsedT = Number(Array.isArray(rawT) ? rawT[0] : rawT);
  const initialSeekSec = Number.isFinite(parsedT) && parsedT >= 0 ? parsedT : null;
  const showSermonMedia = Boolean(sermonMedia?.enabled) && Boolean(access?.allowed.includes("sermon_media")) && (recording.status === "ready" || recording.status === "published");
  // The review player only loads for ready/processing recordings; the panel
  // needs the source for published ones too.
  const sermonMediaPlayback = showSermonMedia ? (playback ?? (await getStaffPlayback(auth.churchId, id))) : null;

  return (
    <div className="flex w-full flex-col gap-8">
      <AutoRefresh active={stillChanging} />
      <RecordingReview
        recording={recording}
        playback={playback}
        series={series.map((item) => ({ id: item.id, name: item.name }))}
        thumbnails={thumbnails}
        settings={settings}
        isAdmin={auth.isAdmin}
        appEnabled={Boolean(access?.flags.member_app)}
        timeZone={auth.churchTimezone ?? "America/New_York"}
        websiteSermonsUrl={websiteSermonsUrl}
        tagSuggestions={tagSuggestions}
        stats={{ live: stats.liveViews, replay: stats.replayViews }}
        artworkSlot={
          auth.isAdmin && mediaItem ? (
            <ItemArtworkPanel
              recordingId={mediaItem.id}
              title={mediaItem.title ?? recording.title}
              artwork={mediaItem.artwork}
              seriesArtwork={mediaItem.seriesArtwork}
              seriesName={mediaItem.seriesName}
              seriesSlug={mediaItem.seriesSlug}
            />
          ) : null
        }
      />
      {showSermonMedia ? (
        <SermonMediaPanel
          recordingId={id}
          playback={sermonMediaPlayback}
          posterUrl={recording.posterUrl}
          title={recording.title}
          durationSec={recording.fullDurationSec ?? recording.durationSec}
          currentUserId={auth.userId}
          initialSeekSec={initialSeekSec}
        />
      ) : null}
    </div>
  );
}
