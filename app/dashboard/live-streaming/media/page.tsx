import { redirect } from "next/navigation";
import { FaithfulPublishingPanel } from "@/components/live-streaming/faithful-publishing-panel";
import { MediaList } from "@/components/live-streaming/media-list";
import { getChurchAuth } from "@/lib/auth/church";
import { listMediaItems } from "@/lib/stream/media-library";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LiveStreamingMediaPage() {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) redirect("/login");

  // The index is a list, not a player: each service opens on its own page.
  // Nothing here signs a playback URL, which also keeps the page fast.
  const items = await listMediaItems(auth.churchId);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-bold">Library</h2>
        <p className="text-sm text-muted-foreground">
          Every service you&apos;ve streamed. Open one to watch it, tag it, or
          see how many people did.
        </p>
      </div>

      <FaithfulPublishingPanel />

      <MediaList items={items} />
    </div>
  );
}
