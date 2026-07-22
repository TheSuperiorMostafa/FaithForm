import { redirect } from "next/navigation";
import { MediaManager } from "@/components/live-streaming/media-manager";
import { getChurchAuth } from "@/lib/auth/church";
import { listStreamRecordings } from "@/lib/stream/recordings";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LiveStreamingMediaPage() {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) redirect("/login");

  const recordings = await listStreamRecordings(auth.churchId, supabase);

  return <MediaManager recordings={recordings} isAdmin={auth.isAdmin} />;
}
