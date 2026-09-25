import { redirect } from "next/navigation";

import { MediaGrid, MediaPageHeader } from "@/components/media/media-grid";
import { getChurchAuth } from "@/lib/auth/church";
import { DASHBOARD_MEDIA_LINKS, loadLibraryBrowse } from "@/lib/media/browse";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function RecordingSeriesIndexPage() {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) redirect("/login");

  const { series } = await loadLibraryBrowse(auth.churchId);

  // Empty series are listed here even though the shelf hides them, because
  // this is the page a church manages series from — a collection it created
  // and has not filed anything into yet has to be findable.
  const ordered = [...series].sort(
    (a, b) => (b.latestAt ?? "").localeCompare(a.latestAt ?? "") || a.name.localeCompare(b.name),
  );

  return (
    <div className="flex w-full flex-col gap-6">
      <MediaPageHeader
        title="All series"
        description="Give a series its artwork once and every message inside it inherits the image."
        backHref="/dashboard/live-streaming/recordings?show=series"
        backLabel="Back to Series"
      />

      <MediaGrid
        series={ordered}
        links={DASHBOARD_MEDIA_LINKS}
        shape="poster"
        emptyMessage="No series yet. Open a recording and file it into one to get started."
      />
    </div>
  );
}
