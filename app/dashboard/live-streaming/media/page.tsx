import { redirect } from "next/navigation";
import { MediaBrowseView } from "@/components/media/media-browse";
import { getChurchAuth } from "@/lib/auth/church";
import { DASHBOARD_MEDIA_LINKS, loadLibraryBrowse } from "@/lib/media/browse";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LiveStreamingMediaPage() {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) redirect("/login");

  // Shelves, not a list. Nothing here signs a playback URL — each service
  // opens on its own page — which is what keeps the index fast even once a
  // church has years of recordings in it.
  const { browse, items } = await loadLibraryBrowse(auth.churchId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-heading text-lg font-bold">Library</h2>
        <p className="text-sm text-muted-foreground">
          Your services, organized into series. Open one to watch it, edit it,
          or publish it.
        </p>
      </div>

      <MediaBrowseView
        browse={browse}
        items={items}
        links={DASHBOARD_MEDIA_LINKS}
        churchId={auth.churchId}
      />
    </div>
  );
}
