"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, CalendarDays, ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateScheduledStream } from "@/app/dashboard/live-streaming/actions";
import { ItemArtworkPanel } from "@/components/media/item-artwork-panel";
import { RecordingExtraFields, RecordingPrimaryFields } from "@/components/media/recording-details-fields";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EMPTY_ARTWORK } from "@/lib/media/artwork";
import type { StreamEvent } from "@/lib/stream/events";
import { formatServiceTime } from "@/lib/stream/format";
import type { MediaSeries } from "@/lib/stream/media-library";

export function UpcomingServiceEditor({ event, series, timeZone }: { event: StreamEvent; series: MediaSeries[]; timeZone: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(event.title);
  const [seriesId, setSeriesId] = useState(event.seriesId ?? "");
  const [newSeries, setNewSeries] = useState("");
  const [speaker, setSpeaker] = useState(event.speaker ?? "");
  const [description, setDescription] = useState(event.description ?? "");
  const [chapters, setChapters] = useState(event.chapters?.join(", ") ?? "");
  const [topics, setTopics] = useState(event.topics?.join(", ") ?? "");
  const selectedSeries = series.find(item => item.id === seriesId);
  const artwork = { poster: event.artworkPosterUrl ?? null, wide: event.artworkWideUrl ?? event.artworkUrl, banner: event.artworkBannerUrl ?? null };
  const preview = artwork.wide ?? selectedSeries?.artwork.wide ?? artwork.poster ?? selectedSeries?.artwork.poster;

  function save() {
    const data = new FormData();
    // Keep folded More options in the save, exactly as recording review does.
    for (const [key, value] of Object.entries({ event_id: event.id, title, series_id: seriesId, new_series_name: newSeries, speaker, description, chapters, topics })) data.set(key, value);
    startTransition(async () => {
      try {
        const result = await updateScheduledStream(data);
        if (!result.ok) { toast.error(result.error ?? "We couldn't save this service. Your changes are still here."); return; }
        toast.success("Service details saved. They will carry over to its recording.");
        if (seriesId === "__new__") { router.push("/dashboard/live-streaming/upcoming"); }
        router.refresh();
      } catch { toast.error("We couldn't save this service. Your changes are still here. Please try again."); }
    });
  }

  return <div className="flex w-full flex-col gap-8">
    <Link href="/dashboard/live-streaming/upcoming" className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden />All upcoming services</Link>
    <div className="flex flex-col gap-3">
      <StatusBadge tone="working">Upcoming</StatusBadge>
      <PageHeader title={title || "Upcoming service"} description={formatServiceTime(event.startsAt, timeZone)} />
    </div>
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl bg-muted">
          {preview ? <>
            {/* eslint-disable-next-line @next/next/no-img-element -- church-supplied artwork */}
            <img src={preview} alt={`Artwork preview for ${title || event.title}`} className="size-full object-cover" />
          </> : <div className="flex flex-col items-center gap-3 px-6 text-center text-[15px] text-muted-foreground"><ImageIcon className="size-8" aria-hidden />Add artwork to preview this service.</div>}
        </div>
        <p className="text-[15px] text-muted-foreground">The video preview will be available in Recordings after this service ends.</p>
      </div>
      <form onSubmit={e => { e.preventDefault(); save(); }} className="flex min-w-0 flex-col gap-6">
        <section aria-labelledby="service-details-heading" className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><CalendarDays className="size-5" aria-hidden /></span>
            <div><h2 id="service-details-heading" className="font-heading text-xl font-semibold">Service details</h2><p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">Prepare the same details and artwork used by your recording.</p></div>
          </div>
          <fieldset disabled={pending} className="flex min-w-0 flex-col gap-5"><legend className="sr-only">Service details</legend>
            <RecordingPrimaryFields idPrefix="upcoming" title={title} onTitleChange={setTitle} seriesId={seriesId} onSeriesChange={setSeriesId} newSeries={newSeries} onNewSeriesChange={setNewSeries} series={series} titleMaxLength={120} />
          </fieldset>
          <ItemArtworkPanel target={{ kind: "service", id: event.id }} artwork={artwork} seriesArtwork={selectedSeries?.artwork ?? EMPTY_ARTWORK} seriesName={selectedSeries?.name ?? null} seriesSlug={selectedSeries?.slug ?? null} />
          <AdvancedSection title="More options" description="Speaker and scripture">
            <fieldset disabled={pending} className="flex min-w-0 flex-col gap-5"><legend className="sr-only">More options</legend>
              <RecordingExtraFields idPrefix="upcoming" speaker={speaker} onSpeakerChange={setSpeaker} description={description} onDescriptionChange={setDescription} chapters={chapters} onChaptersChange={setChapters} topics={topics} onTopicsChange={setTopics} />
            </fieldset>
          </AdvancedSection>
          <div className="flex flex-col gap-3 border-t border-border pt-5"><Button type="submit" size="lg" disabled={pending} className="w-full gap-2">{pending ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : null}{pending ? "Saving…" : "Save service details"}</Button><p className="text-sm text-muted-foreground">Artwork saves when you upload or remove an image.</p></div>
        </section>
      </form>
    </div>
  </div>;
}
