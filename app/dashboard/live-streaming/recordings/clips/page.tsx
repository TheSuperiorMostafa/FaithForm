import Link from "next/link";
import { redirect } from "next/navigation";
import { Clapperboard } from "lucide-react";

import { ClipsStudio } from "@/components/clips/clips-studio";
import { RecordingFilters } from "@/components/live-streaming/recordings/recording-filters";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { getSermonMediaSettings } from "@/lib/sermon-media/access";
import { RECORDINGS_BASE_HREF } from "@/lib/sermon-media/hrefs";

export const dynamic = "force-dynamic";

/**
 * Live > Recordings > Clips: every clip made from the church's recordings,
 * waiting for one-tap approval, then scheduled and posted. Clips are made
 * from a recording's More options, or with Make clips here.
 */
export default async function RecordingClipsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (await pageFeatureBlocked("sermon_media")) return null;
  if (await pageFeatureBlocked("live_stream")) return null;

  const [query, auth] = await Promise.all([searchParams, getChurchAuth()]);
  if (!auth) redirect("/login");

  const settings = await getSermonMediaSettings(auth.churchId).catch(() => null);
  if (!settings?.enabled) {
    return (
      <div className="flex w-full flex-col gap-6">
        <RecordingFilters active="clips" />
        <EmptyState
          icon={Clapperboard}
          title="Clips are being set up"
          description="FaithForm is getting Transcripts & Clips ready for your church. Once it's on, clips from each service will appear here for you to watch and approve."
          action={
            <Link href={RECORDINGS_BASE_HREF} className={buttonVariants({ variant: "outline" })}>
              Back to recordings
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <RecordingFilters active="clips" />
      <ClipsStudio timezone={auth.churchTimezone} initialView={query.view} />
    </div>
  );
}
