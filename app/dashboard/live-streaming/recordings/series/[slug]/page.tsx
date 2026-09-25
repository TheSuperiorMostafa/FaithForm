import { notFound, redirect } from "next/navigation";

import { MediaGrid, MediaPageHeader } from "@/components/media/media-grid";
import { SeriesArtworkPanel } from "@/components/media/series-artwork-panel";
import { getChurchAuth } from "@/lib/auth/church";
import { DASHBOARD_MEDIA_LINKS, loadLibraryBrowse } from "@/lib/media/browse";
import { formatItemCount } from "@/lib/media/shelves";
import { getMediaSeriesBySlug } from "@/lib/stream/media-library";
import { loadRecordingStatuses } from "@/lib/stream/recording-status-server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function RecordingSeriesDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) redirect("/login");

  const series = await getMediaSeriesBySlug(auth.churchId, slug);
  if (!series) notFound();

  const [{ items }, statuses] = await Promise.all([
    loadLibraryBrowse(auth.churchId),
    loadRecordingStatuses(auth.churchId),
  ]);

  // Oldest first, unlike every other list in the dashboard. A series is taught
  // in order, and someone opening it wants part one at the top.
  const inSeries = items
    .filter((item) => item.seriesId === series.id)
    .sort((a, b) => (a.publishedAt ?? a.recordedAt).localeCompare(b.publishedAt ?? b.recordedAt));

  const overridden = inSeries.filter((item) =>
    Boolean(item.artwork?.poster || item.artwork?.wide || item.artwork?.banner),
  ).length;

  return (
    <div className="flex w-full flex-col gap-6">
      <MediaPageHeader
        title={series.name}
        description={series.description ?? formatItemCount(inSeries.length)}
        backHref="/dashboard/live-streaming/recordings?show=series"
        backLabel="Back to Series"
      />

      <SeriesArtworkPanel
        seriesId={series.id}
        artwork={series.artwork}
        itemCount={inSeries.length}
        overriddenCount={overridden}
      />

      <div className="flex flex-col gap-3">
        <h3 className="font-heading text-lg font-bold">In this series</h3>
        <MediaGrid
          items={inSeries}
          links={DASHBOARD_MEDIA_LINKS}
          statuses={statuses}
          shape="wide"
          emptyMessage="Nothing filed into this series yet. Open a recording and choose this series on it."
        />
      </div>
    </div>
  );
}
