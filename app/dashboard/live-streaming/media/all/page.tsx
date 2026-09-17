import { redirect } from "next/navigation";

import { MediaGrid, MediaPageHeader } from "@/components/media/media-grid";
import { getChurchAuth } from "@/lib/auth/church";
import { DASHBOARD_MEDIA_LINKS, loadLibraryBrowse } from "@/lib/media/browse";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AllMediaPage() {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) redirect("/login");

  const { items } = await loadLibraryBrowse(auth.churchId);

  return (
    <div className="flex flex-col gap-6">
      <MediaPageHeader
        title="Everything"
        description={
          items.length === 1
            ? "1 recording, newest first."
            : `${items.length} recordings, newest first.`
        }
        backHref="/dashboard/live-streaming/media"
        backLabel="Library"
      />

      <MediaGrid
        items={items}
        links={DASHBOARD_MEDIA_LINKS}
        shape="wide"
        emptyMessage="No recordings yet. They appear here after a live broadcast ends."
      />
    </div>
  );
}
