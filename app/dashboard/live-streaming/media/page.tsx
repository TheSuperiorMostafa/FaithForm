import { redirect } from "next/navigation";
import {
  MediaManager,
  type RecordingListItem,
} from "@/components/live-streaming/media-manager";
import { getChurchAuth } from "@/lib/auth/church";
import { listStreamRecordings } from "@/lib/stream/recordings";
import { listStreamSessions } from "@/lib/stream/sessions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Long enough to watch a full service without the link dying mid-playback. */
const PLAYBACK_URL_TTL_SECONDS = 60 * 60 * 4;

export default async function LiveStreamingMediaPage() {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) redirect("/login");

  const [recordings, sessions] = await Promise.all([
    listStreamRecordings(auth.churchId, supabase),
    listStreamSessions(auth.churchId, { supabase }),
  ]);

  // Recording files live in a private bucket, so playback needs a signed URL.
  // Signing fails while the file is still being uploaded — that's the signal
  // the card uses to say "still processing" rather than showing a dead player.
  const admin = createAdminClient();
  const items: RecordingListItem[] = await Promise.all(
    recordings.map(async (recording) => {
      const { data } = await admin.storage
        .from("stream-recordings")
        .createSignedUrl(recording.storagePath, PLAYBACK_URL_TTL_SECONDS);

      return {
        id: recording.id,
        title: recording.title,
        createdAt: recording.createdAt,
        durationSec: recording.durationSec,
        playbackUrl: data?.signedUrl ?? null,
      };
    }),
  );

  return <MediaManager recordings={items} sessions={sessions} />;
}
