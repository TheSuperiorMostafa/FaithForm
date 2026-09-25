"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  Scissors,
  Send,
  Smartphone,
  Trash2,
  Undo2,
} from "lucide-react";

import {
  chooseThumbnailAction,
  deleteRecordingAction,
  publishRecordingAction,
  retryRecordingAction,
  saveRecordingDetailsAction,
  trimRecordingAction,
  unpublishRecordingAction,
} from "@/app/dashboard/live-streaming/recording-actions";
import { RecordingPlayer } from "@/components/live-streaming/recording-player";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button, buttonVariants } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { SuccessState } from "@/components/ui/success-state";
import { Textarea } from "@/components/ui/textarea";
import { formatClock, parseClock } from "@/lib/stream/format";
import type { RecordingSettings } from "@/lib/stream/recording-repo";
import type { StaffRecording, ThumbnailChoice } from "@/lib/stream/recording-publication";
import {
  MEMBER_APP,
  publishedWhereSentence,
  RECORDINGS_HREF,
  recordingTone,
} from "@/lib/stream/recording-status";
import { cn } from "@/lib/utils";

type Props = {
  recording: StaffRecording;
  playback: { kind: "hls" | "progressive"; url: string } | null;
  series: Array<{ id: string; name: string }>;
  thumbnails: ThumbnailChoice[];
  settings: RecordingSettings;
  isAdmin: boolean;
  timeZone: string;
  stats: { live: number; replay: number } | null;
  artworkSlot?: React.ReactNode;
};

const NEW_SERIES = "__new__";

/**
 * Watch it, check the title, publish it.
 *
 * The default path is one click: the title and series are filled in from the
 * service, the church's usual audience is already chosen, and the one solid
 * button says exactly what it does — "Publish to the app". The website is a
 * plain checkbox. Everything else (audience, speaker, scripture, topics,
 * artwork, trimming, a website-only publish) is folded under "More options",
 * and deleting sits in a quiet section at the very bottom.
 */
export function RecordingReview({
  recording,
  playback,
  series,
  thumbnails,
  settings,
  isAdmin,
  timeZone,
  stats,
  artworkSlot,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState(recording.title);
  const [speaker, setSpeaker] = useState(recording.speaker ?? "");
  const [description, setDescription] = useState(recording.description ?? "");
  // Pre-filled: its own series, or the church's usual one for a recording
  // that hasn't been published yet.
  const [seriesChoice, setSeriesChoice] = useState(
    recording.seriesId ??
      (recording.app.published || recording.website.published ? "" : (settings.defaultSeriesId ?? "")),
  );
  const [newSeries, setNewSeries] = useState("");
  const [chapters, setChapters] = useState(recording.chapters.join(", "));
  const [topics, setTopics] = useState(recording.topics.join(", "));
  const [listed, setListed] = useState(recording.website.listed);

  const [toApp, setToApp] = useState(recording.app.published || !recording.website.published);
  const [toWebsite, setToWebsite] = useState(recording.website.published || settings.publishToWebsite);
  const [audience, setAudience] = useState<RecordingSettings["defaultVisibility"]>(
    recording.app.visibility ?? settings.defaultVisibility,
  );
  const [notify, setNotify] = useState(settings.notifyOnPublish);

  const [trimOpen, setTrimOpen] = useState(false);
  const [trimStart, setTrimStart] = useState(formatClock(recording.trimStartSec));
  const [trimEnd, setTrimEnd] = useState(
    recording.trimEndSec !== null
      ? formatClock(recording.trimEndSec)
      : recording.fullDurationSec
        ? formatClock(recording.fullDurationSec)
        : "",
  );
  const [position, setPosition] = useState(0);
  const [poster, setPoster] = useState(recording.chosenPosterUrl ?? recording.autoPosterUrl ?? null);
  const [justPublished, setJustPublished] = useState<{ app: boolean; website: boolean } | null>(null);

  const published = recording.app.published || recording.website.published;
  const phase = recording.phase.phase;
  const originalPoster = recording.chosenPosterUrl ?? recording.autoPosterUrl ?? null;
  const posterDirty = poster !== originalPoster;
  const detailsDirty =
    title.trim() !== recording.title ||
    speaker.trim() !== (recording.speaker ?? "") ||
    description.trim() !== (recording.description ?? "") ||
    (seriesChoice === NEW_SERIES ? newSeries.trim().length > 0 : seriesChoice !== (recording.seriesId ?? "")) ||
    chapters !== recording.chapters.join(", ") ||
    topics !== recording.topics.join(", ") ||
    listed !== recording.website.listed;
  const dirty = detailsDirty || posterDirty;
  const publishingChange =
    (toApp && !recording.app.published) ||
    (toWebsite && !recording.website.published) ||
    (recording.app.published && audience !== recording.app.visibility);

  const splitTags = (value: string) => value.split(",").map((tag) => tag.trim()).filter(Boolean);

  async function saveDetails(): Promise<boolean> {
    if (posterDirty) {
      const chosen = await chooseThumbnailAction({ recordingId: recording.id, url: poster });
      if (!chosen.ok) {
        toast.error(chosen.error);
        return false;
      }
    }
    if (!detailsDirty) return true;
    const result = await saveRecordingDetailsAction({
      recordingId: recording.id,
      title,
      description,
      speaker,
      seriesId: seriesChoice && seriesChoice !== NEW_SERIES ? seriesChoice : null,
      newSeriesName: seriesChoice === NEW_SERIES ? newSeries : undefined,
      listedOnWebsite: listed,
      chapters: splitTags(chapters),
      topics: splitTags(topics),
    });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    return true;
  }

  const save = () =>
    startTransition(async () => {
      if (await saveDetails()) {
        toast.success(`Changes to “${title.trim() || recording.title}” saved.`);
        router.refresh();
      }
    });

  const publish = () =>
    startTransition(async () => {
      if (!toApp && !toWebsite) {
        toast.error("Choose where to publish it: the app, your website, or both.");
        return;
      }
      if (!(await saveDetails())) return;
      const result = await publishRecordingAction({
        recordingId: recording.id,
        appVisibility: toApp ? audience : null,
        website: toWebsite,
        notifyMembers: toApp && notify,
      });
      if (!result.ok) {
        toast.error(result.error);
        router.refresh();
        return;
      }
      const where = {
        app: result.data?.app.published ?? toApp,
        website: result.data?.website.published ?? toWebsite,
      };
      const name = title.trim() || recording.title;
      if (published) {
        toast.success(`Publishing for “${name}” updated.`);
      } else {
        setJustPublished(where);
        toast.success(`“${name}” is published. ${publishedWhereSentence(where)}`);
      }
      router.refresh();
    });

  const unpublish = async () => {
    const ok = await confirmAction({
      title: "Unpublish this recording?",
      description: `It will be removed from the ${MEMBER_APP} and your website. The recording itself stays saved, and you can publish it again any time.`,
      confirmLabel: "Unpublish recording",
      cancelLabel: "Keep it published",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await unpublishRecordingAction(recording.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setJustPublished(null);
      toast.success(`“${recording.title}” is unpublished. The recording is still saved.`);
      router.refresh();
    });
  };

  const remove = async () => {
    const ok = await confirmAction({
      title: "Delete this recording permanently?",
      description: `The video is removed from FaithForm, the ${MEMBER_APP} and your website, and can't be recovered. If you only want to hide it, unpublish it instead.`,
      confirmLabel: "Delete recording",
      cancelLabel: "Keep it",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await deleteRecordingAction(recording.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`“${recording.title}” is deleted.`);
      router.push(RECORDINGS_HREF);
    });
  };

  const saveTrim = () =>
    startTransition(async () => {
      const start = parseClock(trimStart);
      const end = trimEnd.trim() ? parseClock(trimEnd) : null;
      if (start === null || (trimEnd.trim() && end === null)) {
        toast.error("Use times like 3:42 or 1:04:18.");
        return;
      }
      const result = await trimRecordingAction({ recordingId: recording.id, startSec: start, endSec: end });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setTrimStart(formatClock(result.data.startSec));
      setTrimEnd(formatClock(result.data.endSec ?? recording.fullDurationSec ?? result.data.durationSec));
      toast.success(`Trimmed. “${recording.title}” now runs ${formatClock(result.data.durationSec)}.`);
      router.refresh();
    });

  const retry = () =>
    startTransition(async () => {
      const result = await retryRecordingAction(recording.id);
      if (!result.ok) toast.error(result.error);
      else toast.success("Trying again. This page updates by itself when it's ready.");
      router.refresh();
    });

  const playerSrc =
    playback && trimOpen && playback.kind === "hls" ? playback.url.replace(/index\.m3u8$/, "full.m3u8") : playback?.url;

  const recordedOn = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(recording.recordedAt));

  const canEdit = isAdmin && phase !== "recording";
  const primaryLabel = published
    ? publishingChange
      ? "Update publishing"
      : "Save changes"
    : toApp
      ? "Publish to the app"
      : "Publish to the website";
  const showPrimary = !published || publishingChange || dirty;

  return (
    <div className="flex w-full flex-col gap-8">
      <Link
        href={RECORDINGS_HREF}
        className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All recordings
      </Link>

      <header className="flex flex-col gap-3">
        <StatusBadge tone={recordingTone(phase)} size="lg" className="w-fit">
          {recording.phase.label}
        </StatusBadge>
        <h2 className="font-heading text-3xl font-bold leading-tight">{recording.title}</h2>
        <p className="text-base text-muted-foreground">
          {recordedOn}
          {recording.durationSec ? ` · ${formatClock(recording.durationSec)}` : ""}
        </p>
      </header>

      {phase === "needs_attention" || phase === "preparing" || phase === "recording" ? (
        <div
          className={cn(
            "flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between",
            phase === "needs_attention"
              ? "border-orange-200 bg-orange-50 dark:border-orange-500/30 dark:bg-orange-500/10"
              : "border-border bg-muted/40",
          )}
          role={phase === "needs_attention" ? "alert" : "status"}
        >
          <p className="flex items-start gap-3 text-base">
            {phase === "needs_attention" ? (
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-orange-600 dark:text-orange-300" aria-hidden />
            ) : (
              <Loader2 className="mt-0.5 size-5 shrink-0 text-muted-foreground motion-safe:animate-spin" aria-hidden />
            )}
            {recording.phase.detail}
          </p>
          {phase === "needs_attention" ? (
            <div className="flex shrink-0 flex-wrap gap-2">
              {isAdmin && recording.segmentCount > 0 ? (
                <Button onClick={retry} disabled={pending} className="gap-2">
                  <RefreshCw className="size-4" aria-hidden />
                  Try again
                </Button>
              ) : null}
              <Link href="/dashboard/support" className={buttonVariants({ variant: "outline" })}>
                Get help
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {justPublished ? (
        <SuccessState
          title="Published"
          description={publishedWhereSentence(justPublished)}
          actions={
            <>
              {recording.watchUrl ? (
                <a
                  href={recording.watchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
                >
                  View on your website <ExternalLink className="size-4" aria-hidden />
                </a>
              ) : null}
              <Link href={RECORDINGS_HREF} className={buttonVariants({ variant: "outline" })}>
                Back to recordings
              </Link>
              <Button variant="ghost" onClick={() => setJustPublished(null)}>
                Done
              </Button>
            </>
          }
        />
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {playback && playerSrc ? (
            <RecordingPlayer
              key={playerSrc}
              src={playerSrc}
              kind={playback.kind}
              poster={recording.posterUrl}
              title={recording.title}
              onTimeUpdate={setPosition}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-2xl bg-muted px-6 text-center text-[15px] text-muted-foreground">
              {phase === "recording" ? "The preview appears when the service ends." : "No video to preview yet."}
            </div>
          )}

          {canEdit && recording.status === "ready" ? (
            <section className="rounded-2xl border border-border bg-card">
              <button
                type="button"
                onClick={() => setTrimOpen((open) => !open)}
                aria-expanded={trimOpen}
                className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-2 text-base font-semibold">
                  <Scissors className="size-5 text-accent" aria-hidden />
                  Trim the beginning or end
                </span>
                <ChevronDown
                  className={cn("size-5 transition-transform motion-reduce:transition-none", trimOpen && "rotate-180")}
                  aria-hidden
                />
              </button>
              {trimOpen ? (
                <div className="flex flex-col gap-4 border-t border-border p-5">
                  <p className="text-[15px] text-muted-foreground">
                    Started streaming early, or left it running after the service? Choose where the recording should
                    start and end. Play the video above to find the moments.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TimeField
                      id="trim-start"
                      label="Start"
                      value={trimStart}
                      onChange={setTrimStart}
                      onUseCurrent={() => setTrimStart(formatClock(position))}
                    />
                    <TimeField
                      id="trim-end"
                      label="End"
                      value={trimEnd}
                      onChange={setTrimEnd}
                      onUseCurrent={() => setTrimEnd(formatClock(position))}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={saveTrim} disabled={pending} variant="outline">
                      Save trim
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      FaithForm keeps a few extra seconds at each edge rather than cut into your service.
                    </span>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {canEdit && thumbnails.length > 0 ? (
            <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
              <div>
                <h3 className="font-heading text-lg font-semibold">Cover picture</h3>
                <p className="text-[15px] text-muted-foreground">Chosen automatically. Pick another if you like.</p>
              </div>
              <div role="radiogroup" aria-label="Cover picture" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {thumbnails.map((choice) => (
                  <button
                    key={choice.url}
                    type="button"
                    role="radio"
                    aria-checked={poster === choice.url}
                    aria-label={choice.label}
                    onClick={() => setPoster(choice.url)}
                    className={cn(
                      "relative aspect-video overflow-hidden rounded-lg border-2 bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      poster === choice.url ? "border-accent" : "border-transparent",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={choice.url} alt="" className="size-full object-cover" loading="lazy" />
                    {poster === choice.url ? (
                      <CheckCircle2 className="absolute right-1 top-1 size-5 rounded-full bg-white text-accent" aria-hidden />
                    ) : null}
                  </button>
                ))}
              </div>
              {recording.hasCustomArtwork ? (
                <p className="text-sm text-muted-foreground">Your own artwork is used in the app instead.</p>
              ) : null}
            </section>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <section
            aria-labelledby="publish-heading"
            className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none"
          >
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <Send className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <div>
                <h3 id="publish-heading" className="font-heading text-xl font-semibold">
                  {published ? "Where it appears" : "Publish this recording"}
                </h3>
                <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">
                  {published
                    ? publishedWhereSentence({ app: recording.app.published, website: recording.website.published })
                    : `Members will find it in the ${MEMBER_APP} under Services.`}
                </p>
              </div>
            </div>

            {published ? (
              <ul className="flex flex-col gap-2 text-[15px]">
                <li className="inline-flex items-center gap-2">
                  {recording.app.published ? (
                    <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-300" aria-hidden />
                  ) : (
                    <Smartphone className="size-5 text-muted-foreground" aria-hidden />
                  )}
                  {recording.app.published ? `In the ${MEMBER_APP}` : `Not in the ${MEMBER_APP}`}
                </li>
                <li className="inline-flex items-center gap-2">
                  {recording.website.published ? (
                    <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-300" aria-hidden />
                  ) : (
                    <Globe className="size-5 text-muted-foreground" aria-hidden />
                  )}
                  {recording.website.published ? "On your church website" : "Not on your church website"}
                </li>
              </ul>
            ) : null}

            <fieldset disabled={!canEdit || pending} className="flex min-w-0 flex-col gap-5">
              <legend className="sr-only">Recording details</legend>
              <Field id="rec-title" label="Title">
                <Input id="rec-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
              </Field>
              <Field id="rec-series" label="Series" optional>
                <Select id="rec-series" value={seriesChoice} onChange={(event) => setSeriesChoice(event.target.value)}>
                  <option value="">No series</option>
                  {series.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                  <option value={NEW_SERIES}>New series…</option>
                </Select>
                {seriesChoice === NEW_SERIES ? (
                  <Input
                    className="mt-2"
                    value={newSeries}
                    onChange={(event) => setNewSeries(event.target.value)}
                    placeholder="Series name"
                    aria-label="New series name"
                    maxLength={120}
                  />
                ) : null}
              </Field>
              <Check
                checked={toWebsite}
                onChange={setToWebsite}
                disabled={recording.website.published}
                icon={<Globe className="size-5" aria-hidden />}
                label="Also show it on your church website"
                hint={
                  recording.website.published
                    ? "It's on your website. To take it down, use Unpublish below."
                    : "Anyone can watch it on your church's watch page, without the app."
                }
              />
            </fieldset>

            <AdvancedSection title="More options" description="Who can watch, speaker, scripture and artwork">
              <fieldset disabled={!canEdit || pending} className="flex min-w-0 flex-col gap-5">
                <legend className="sr-only">More options</legend>
                <Check
                  checked={toApp}
                  onChange={setToApp}
                  disabled={recording.app.published}
                  icon={<Smartphone className="size-5" aria-hidden />}
                  label={`Show it in the ${MEMBER_APP}`}
                  hint={
                    recording.app.published
                      ? "It's in the app. To take it out, use Unpublish below."
                      : "Untick to put it on your website only."
                  }
                />
                <Field id="rec-audience" label="Who can watch it in the app">
                  <Select
                    id="rec-audience"
                    value={audience}
                    onChange={(event) => setAudience(event.target.value as RecordingSettings["defaultVisibility"])}
                  >
                    <option value="public">Everyone</option>
                    <option value="followers">People who follow your church</option>
                    <option value="members">Members only</option>
                  </Select>
                </Field>
                <Check
                  checked={notify}
                  onChange={setNotify}
                  label="Let members know it's available"
                  hint="Sends one notification in the app when it's first published."
                />
                <Check
                  checked={listed}
                  onChange={setListed}
                  label="List it on your website"
                  hint="Off: only people with the link can find it."
                />
                <Field id="rec-speaker" label="Speaker" optional>
                  <Input
                    id="rec-speaker"
                    value={speaker}
                    onChange={(event) => setSpeaker(event.target.value)}
                    placeholder="Pastor John"
                    maxLength={120}
                  />
                </Field>
                <Field id="rec-description" label="Description" optional>
                  <Textarea
                    id="rec-description"
                    placeholder="What was this service about?"
                    className="min-h-28 resize-y"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={3}
                    maxLength={2000}
                  />
                </Field>
                <Field id="rec-chapters" label="Scripture" optional>
                  <Input
                    id="rec-chapters"
                    value={chapters}
                    onChange={(event) => setChapters(event.target.value)}
                    placeholder="John 3, Romans 8"
                  />
                </Field>
                <Field id="rec-topics" label="Topics" optional>
                  <Input
                    id="rec-topics"
                    value={topics}
                    onChange={(event) => setTopics(event.target.value)}
                    placeholder="Grace, Prayer"
                  />
                </Field>
              </fieldset>
              {artworkSlot}
            </AdvancedSection>

            {isAdmin ? (
              <div className="flex flex-col gap-3 border-t border-border pt-5">
                {showPrimary ? (
                  <Button
                    size="lg"
                    onClick={published && !publishingChange ? save : publish}
                    disabled={
                      pending ||
                      (!published && !recording.canPublish) ||
                      (!toApp && !toWebsite) ||
                      phase === "recording"
                    }
                    className="w-full gap-2"
                  >
                    {pending ? (
                      <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
                    ) : (
                      <Send className="size-4" aria-hidden />
                    )}
                    {primaryLabel}
                  </Button>
                ) : null}
                {!recording.canPublish && recording.publishBlockedReason && !published ? (
                  <p className="text-[15px] text-muted-foreground">{recording.publishBlockedReason}</p>
                ) : null}
                {!published && dirty ? (
                  <Button variant="ghost" onClick={save} disabled={pending}>
                    Save without publishing
                  </Button>
                ) : null}
                {published ? (
                  <div className="flex flex-wrap gap-2">
                    {recording.watchUrl ? (
                      <a
                        href={recording.watchUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
                      >
                        View on your website <ExternalLink className="size-4" aria-hidden />
                      </a>
                    ) : null}
                    <Button variant="outline" onClick={() => void unpublish()} disabled={pending} className="gap-2">
                      <Undo2 className="size-4" aria-hidden />
                      Unpublish
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-[15px] text-muted-foreground">A church admin can publish this recording.</p>
            )}
          </section>

          {stats && (stats.live > 0 || stats.replay > 0) ? (
            <p className="text-[15px] text-muted-foreground">
              {stats.live > 0 ? `${stats.live} watched live` : null}
              {stats.live > 0 && stats.replay > 0 ? " · " : null}
              {stats.replay > 0 ? `${stats.replay} watched the replay` : null}
            </p>
          ) : null}
        </div>
      </div>

      {isAdmin ? (
        <section
          aria-labelledby="delete-heading"
          className="flex flex-col gap-4 rounded-2xl border border-destructive/20 bg-destructive/[0.03] p-6 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="space-y-1">
            <h3 id="delete-heading" className="font-heading text-lg font-semibold">
              Delete recording
            </h3>
            <p className="text-[15px] text-muted-foreground">
              Removes the video from FaithForm, the app and your website for good. To only hide it, unpublish it.
            </p>
          </div>
          <Button variant="destructive" onClick={() => void remove()} disabled={pending} className="shrink-0 gap-2">
            <Trash2 className="size-4" aria-hidden />
            Delete recording
          </Button>
        </section>
      ) : null}
    </div>
  );
}

function Field({
  id,
  label,
  optional,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-[15px]">
        {label}
        {optional ? <span className="ml-1 font-normal text-muted-foreground">(optional)</span> : null}
      </Label>
      {children}
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
  hint,
  icon,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "relative flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-ring has-[:disabled]:cursor-default has-[:disabled]:opacity-70 motion-reduce:transition-none",
        checked ? "border-accent/60 bg-accent/5" : "border-border bg-background hover:border-accent/40",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
          checked ? "border-accent bg-accent text-accent-foreground" : "border-muted-foreground/40 bg-card",
        )}
      >
        {checked ? <CheckCircle2 className="size-3.5" /> : null}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="inline-flex items-center gap-2 text-[15px] font-medium">
          {icon}
          {label}
        </span>
        {hint ? <span className="text-sm leading-relaxed text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

function TimeField({
  id,
  label,
  value,
  onChange,
  onUseCurrent,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onUseCurrent: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-[15px]">
        {label}
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="numeric"
          placeholder="0:00"
          className="font-mono tabular-nums"
        />
        <Button type="button" variant="outline" onClick={onUseCurrent}>
          Use video time
        </Button>
      </div>
    </div>
  );
}
