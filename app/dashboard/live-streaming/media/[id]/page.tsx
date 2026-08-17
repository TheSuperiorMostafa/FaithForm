import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { MediaDetail } from "@/components/live-streaming/media-detail";
import { getChurchAuth } from "@/lib/auth/church";
import {
  getMediaItem,
  getMediaSessionId,
  getMediaStats,
  listMediaSeries,
} from "@/lib/stream/media-library";
import { getRecordingWatchUrl } from "@/lib/site-url";
import { STREAM_RECORDINGS_BUCKET } from "@/lib/stream/recording-storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Long enough to watch a full service without the link dying mid-playback. */
const PLAYBACK_URL_TTL_SECONDS = 60 * 60 * 4;

export default async function MediaItemPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) redirect("/login");

  const item = await getMediaItem(auth.churchId, params.id);
  if (!item) notFound();

  const sessionId = await getMediaSessionId(auth.churchId, params.id);

  const [series, stats, churchRow] = await Promise.all([
    listMediaSeries(auth.churchId),
    getMediaStats(auth.churchId, params.id, sessionId),
    supabase.from("churches").select("slug").eq("id", auth.churchId).maybeSingle(),
  ]);

  const slug = (churchRow.data?.slug as string | null) ?? null;

  // Recording files live in a private bucket, so playback needs a signed URL.
  const admin = createAdminClient();
  const { data: signed } = await admin.storage
    .from(STREAM_RECORDINGS_BUCKET)
    .createSignedUrl(item.storagePath, PLAYBACK_URL_TTL_SECONDS);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/dashboard/live-streaming/media"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to library
      </Link>

      <MediaDetail
        item={item}
        series={series}
        stats={stats}
        playbackUrl={signed?.signedUrl ?? null}
        shareUrl={slug ? getRecordingWatchUrl(slug, item.id) : null}
        isAdmin={auth.isAdmin}
      />
    </div>
  );
}
