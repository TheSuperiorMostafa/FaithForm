import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, FileUp, Music } from "lucide-react";
import { AddSongButton, StarterHymnsButton, UsageReportButton } from "@/components/service-plans/songs/library-actions";
import { SongLibrary } from "@/components/service-plans/songs/song-library";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { localDateInTimeZone } from "@/lib/checkin/service-week";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { SONGS_DESCRIPTION, SONGS_TITLE } from "@/lib/service-plans/songs/page-copy";
import { listSongs } from "@/lib/service-plans/songs/queries";
import { STARTER_HYMNS } from "@/lib/service-plans/songs/starter-hymns";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SongLibraryPage() {
  if (await pageFeatureBlocked("service_plans")) return null;
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const today = localDateInTimeZone(auth.churchTimezone);
  const songs = await listSongs(createClient(), auth.churchId, today);

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Button variant="link" className="w-fit" nativeButton={false} render={<Link href="/dashboard/plans?home=1" />}>
          <ArrowLeft aria-hidden className="size-4" />
          Service Plans
        </Button>
        <PageHeader
          title={SONGS_TITLE}
          description={SONGS_DESCRIPTION}
          icon={Music}
          secondary={
            <>
              <Button variant="outline" size="lg" nativeButton={false} render={<Link href="/dashboard/plans/songs/import" />}>
                <FileUp aria-hidden className="size-5" />
                Import
              </Button>
              <UsageReportButton defaultFrom={`${today.slice(0, 4)}-01-01`} defaultTo={today} />
            </>
          }
          action={<AddSongButton />}
        />
      </div>

      {songs.length === 0 ? (
        <EmptyState
          icon={Music}
          title="Add your first songs"
          description={`Start with ${STARTER_HYMNS.length} classic public-domain hymns, such as Amazing Grace and It Is Well, import the files you already have, or add a song by hand.`}
          action={
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <StarterHymnsButton count={STARTER_HYMNS.length} />
              <Button variant="outline" size="lg" nativeButton={false} render={<Link href="/dashboard/plans/songs/import" />}>
                <FileUp aria-hidden className="size-5" />
                Import songs
              </Button>
            </div>
          }
        />
      ) : (
        <SongLibrary songs={songs} />
      )}
    </div>
  );
}
