import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarDays, ExternalLink, FileUp, History, Music } from "lucide-react";
import { ArrangementsEditor } from "@/components/service-plans/songs/arrangements-editor";
import { SongDetailsForm } from "@/components/service-plans/songs/song-details-form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { List, ListRow } from "@/components/ui/list-row";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { getChurchAuth } from "@/lib/auth/church";
import { localDateInTimeZone } from "@/lib/checkin/service-week";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { songSelectUrl } from "@/lib/service-plans/songs/catalog";
import { ARRANGEMENTS_DESCRIPTION, SONG_SECTIONS } from "@/lib/service-plans/songs/page-copy";
import { getSongDetail } from "@/lib/service-plans/songs/queries";
import { formatPlanDate } from "@/lib/service-plans/timing";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USAGE_SHOWN = 50;

type PageProps = { params: Promise<{ songId: string }> };

export default async function SongPage({ params }: PageProps) {
  if (await pageFeatureBlocked("service_plans")) return null;
  const [{ songId }, auth] = await Promise.all([params, getChurchAuth()]);
  if (!auth) redirect("/login");
  if (!UUID.test(songId)) notFound();

  const song = await getSongDetail(createClient(), auth.churchId, songId);
  if (!song) notFound();

  const today = localDateInTimeZone(auth.churchTimezone);
  const past = song.usage.filter((u) => u.date <= today).length;
  const description =
    [song.author, song.ccliNumber ? `CCLI ${song.ccliNumber}` : null, song.copyright].filter(Boolean).join(" · ") ||
    "Add the writers and CCLI song number below.";
  const chartUrl = songSelectUrl(song.ccliNumber);

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Button variant="link" className="w-fit" nativeButton={false} render={<Link href="/dashboard/plans/songs" />}>
          <ArrowLeft aria-hidden className="size-4" />
          Song library
        </Button>
        <PageHeader
          title={song.title}
          description={description}
          icon={Music}
          secondary={
            <>
              {chartUrl && (
                <Button
                  variant="outline"
                  size="lg"
                  nativeButton={false}
                  render={<a href={chartUrl} target="_blank" rel="noopener noreferrer" />}
                >
                  <ExternalLink aria-hidden className="size-5" />
                  Get chart
                  <span className="sr-only"> on SongSelect (opens in a new tab)</span>
                </Button>
              )}
              <Button
                variant="outline"
                size="lg"
                nativeButton={false}
                render={<Link href="/dashboard/plans/songs/import" />}
              >
                <FileUp aria-hidden className="size-5" />
                Add chart file
              </Button>
            </>
          }
        />
        {chartUrl && (
          <p className="text-sm text-muted-foreground">
            Get chart opens this song on SongSelect. Download the ChordPro file there, then use Add chart file and it
            joins this song by its CCLI number.
          </p>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="song-details-title" className="flex flex-col gap-4">
          <SectionHeader id="song-details-title" title={SONG_SECTIONS.details} />
          <SongDetailsForm
            song={{
              id: song.id,
              title: song.title,
              author: song.author,
              ccliNumber: song.ccliNumber,
              copyright: song.copyright,
              defaultKey: song.defaultKey,
              tempo: song.tempo,
              tags: song.tags,
            }}
          />
        </section>

        <section aria-labelledby="song-usage-title" className="flex flex-col gap-4">
          <SectionHeader
            id="song-usage-title"
            title={SONG_SECTIONS.usage}
            description={
              song.usage.length
                ? `Sung ${past} ${past === 1 ? "time" : "times"}${song.usage.length > past ? `, planned ${song.usage.length - past} more` : ""}.`
                : "Plans that include this song show here."
            }
          />
          {song.usage.length === 0 ? (
            <EmptyState
              compact
              icon={History}
              title="Not in any plan yet"
              description="Add it to a service from the plan screen and it will show here."
            />
          ) : (
            <List label="Plans with this song">
              {song.usage.slice(0, USAGE_SHOWN).map((use) => (
                <ListRow
                  key={`${use.planId}-${use.date}-${use.arrangementName ?? ""}`}
                  compact
                  href={`/dashboard/plans/${use.serviceTypeId}/${use.planId}`}
                  leading={
                    <span
                      aria-hidden
                      className="flex size-10 items-center justify-center rounded-xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
                    >
                      <CalendarDays className="size-5" strokeWidth={1.75} />
                    </span>
                  }
                  title={formatPlanDate(use.date, "short")}
                  subtitle={[
                    use.serviceTypeName,
                    use.planTitle,
                    use.arrangementName,
                    use.key ? `Key of ${use.key}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  status={use.date > today ? <StatusBadge tone="working">Planned</StatusBadge> : undefined}
                />
              ))}
            </List>
          )}
          {song.usage.length > USAGE_SHOWN && (
            <p className="text-sm text-muted-foreground">
              Showing the latest {USAGE_SHOWN}. The usage report has every date.
            </p>
          )}
        </section>
      </div>

      <section aria-labelledby="song-arrangements-title" className="flex flex-col gap-4">
        <SectionHeader
          id="song-arrangements-title"
          title={SONG_SECTIONS.arrangements}
          description={ARRANGEMENTS_DESCRIPTION}
        />
        <ArrangementsEditor songId={song.id} defaultKey={song.defaultKey} arrangements={song.arrangements} />
      </section>
    </div>
  );
}
