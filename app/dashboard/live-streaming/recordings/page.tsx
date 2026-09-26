import { redirect } from "next/navigation";

import { AutoRefresh } from "@/components/live-streaming/recordings/auto-refresh";
import { RecordingFilters } from "@/components/live-streaming/recordings/recording-filters";
import { RecordingList } from "@/components/live-streaming/recordings/recording-list";
import { RecordingsLoadError } from "@/components/live-streaming/recordings/recordings-load-error";
import { MediaBrowseView } from "@/components/media/media-browse";
import { getChurchAuth } from "@/lib/auth/church";
import { DASHBOARD_MEDIA_LINKS, loadLibraryBrowse } from "@/lib/media/browse";
import { listStaffRecordings, type StaffRecording } from "@/lib/stream/recording-publication";
import {
  filterRecordings,
  isStillChanging,
  parseRecordingFilter,
  searchRecordings,
} from "@/lib/stream/recording-status";
import { loadRecordingStatuses } from "@/lib/stream/recording-status-server";

export const dynamic = "force-dynamic";

/**
 * Recordings: every service FaithForm recorded, one list, each with its state
 * and the next thing to do. "Series" is the old Library tab — shelves of
 * series, topics and speakers, with search — so nothing it offered is lost.
 */
export default async function RecordingsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[]; q?: string | string[] }>;
}) {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");
  const query = await searchParams;
  const filter = parseRecordingFilter(query.show);
  const search = (Array.isArray(query.q) ? query.q[0] : query.q)?.trim() ?? "";

  if (filter === "series") {
    let library: Awaited<ReturnType<typeof loadLibraryBrowse>>;
    let statuses: Awaited<ReturnType<typeof loadRecordingStatuses>>;
    try {
      [library, statuses] = await Promise.all([
        loadLibraryBrowse(auth.churchId),
        loadRecordingStatuses(auth.churchId),
      ]);
    } catch {
      return (
        <div className="flex w-full flex-col gap-6">
          <RecordingFilters active="series" />
          <RecordingsLoadError />
        </div>
      );
    }
    return (
      <div className="flex w-full flex-col gap-6">
        <RecordingFilters active="series" />
        <p className="text-base text-muted-foreground">
          Browse by series, topic and speaker. Give a series its artwork once, and every message in it uses it.
        </p>
        <MediaBrowseView
          browse={library.browse}
          items={library.items}
          links={DASHBOARD_MEDIA_LINKS}
          churchId={auth.churchId}
          statuses={statuses}
        />
      </div>
    );
  }

  let recordings: StaffRecording[];
  try {
    recordings = await listStaffRecordings(auth.churchId, { limit: 60 });
  } catch {
    return (
      <div className="flex w-full flex-col gap-6">
        <RecordingFilters active={filter} search={search} />
        <RecordingsLoadError />
      </div>
    );
  }

  const counts = {
    all: recordings.length,
    published: recordings.filter((recording) => recording.phase.phase === "published").length,
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <AutoRefresh active={recordings.some((recording) => isStillChanging(recording.phase.phase))} />
      <RecordingFilters active={filter} counts={counts} search={search} />
      <RecordingList
        recordings={searchRecordings(filterRecordings(recordings, filter), search)}
        filter={filter}
        search={search}
        timeZone={auth.churchTimezone ?? "America/New_York"}
        isAdmin={auth.isAdmin}
      />
    </div>
  );
}
