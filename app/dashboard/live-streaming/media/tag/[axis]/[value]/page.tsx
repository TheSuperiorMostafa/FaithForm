import { notFound, redirect } from "next/navigation";

import { MediaGrid, MediaPageHeader } from "@/components/media/media-grid";
import { getChurchAuth } from "@/lib/auth/church";
import { DASHBOARD_MEDIA_LINKS, loadLibraryBrowse } from "@/lib/media/browse";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Everything tagged with one topic or one speaker.
 *
 * Matched case-insensitively, for the same reason `countTags` folds case: a
 * church that typed "Prayer" in January and "prayer" in March means one topic,
 * and a page that showed only half the results would look like data loss.
 */
export default async function MediaTagPage({
  params,
}: {
  params: Promise<{ axis: string; value: string }>;
}) {
  const { axis, value } = await params;
  if (axis !== "topic" && axis !== "speaker") notFound();

  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) redirect("/login");

  const label = decodeURIComponent(value);
  const needle = label.trim().toLowerCase();
  if (!needle) notFound();

  const { items } = await loadLibraryBrowse(auth.churchId);

  const matching = items.filter((item) =>
    (axis === "topic" ? item.topics : item.speakers).some(
      (tag) => tag.trim().toLowerCase() === needle,
    ),
  );

  if (matching.length === 0) notFound();

  return (
    <div className="flex flex-col gap-6">
      <MediaPageHeader
        title={label}
        description={
          axis === "topic"
            ? "Every message tagged with this topic."
            : "Every message tagged with this speaker."
        }
        backHref="/dashboard/live-streaming/media"
        backLabel="Library"
      />

      <MediaGrid
        items={matching}
        links={DASHBOARD_MEDIA_LINKS}
        shape="wide"
        emptyMessage="Nothing is tagged with this yet."
      />
    </div>
  );
}
