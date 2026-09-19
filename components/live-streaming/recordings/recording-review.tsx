"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Globe,
  Loader2,
  MoreHorizontal,
  Scissors,
  Smartphone,
  Trash2,
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
import { RecordingPhaseBadge } from "@/components/live-streaming/recordings/recording-phase-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatClock, parseClock } from "@/lib/stream/format";
import type { RecordingSettings } from "@/lib/stream/recording-repo";
import type { StaffRecording, ThumbnailChoice } from "@/lib/stream/recording-publication";
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
 * Watch it, fix the details, publish it.
 *
 * The default path needs one click: everything is filled in from the service
 * (title, date, automatic thumbnail, the church's usual audience), so Publish
 * is ready the moment the recording is. Anything more — audience, website
 * listing, tags, custom artwork, trimming — is folded under "More options".
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
  const [seriesChoice, setSeriesChoice] = useState(recording.seriesId ?? "");
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

  const [moreOpen, setMoreOpen] = useState(false);
  const [trimOpen, setTrimOpen] = useState(false);
  const [trimStart, setTrimStart] = useState(formatClock(recording.trimStartSec));
  const [trimEnd, setTrimEnd] = useState(
    recording.trimEndSec !== null ? formatClock(recording.trimEndSec) : recording.fullDurationSec ? formatClock(recording.fullDurationSec) : "",
  );
  const [position, setPosition] = useState(0);
  const [poster, setPoster] = useState(recording.chosenPosterUrl ?? recording.autoPosterUrl ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);

  const published = recording.app.published || recording.website.published;
  const phase = recording.phase.phase;
  const dirty =
    title.trim() !== recording.title ||
    speaker.trim() !== (recording.speaker ?? "") ||
    description.trim() !== (recording.description ?? "") ||
    (seriesChoice === NEW_SERIES ? newSeries.trim().length > 0 : seriesChoice !== (recording.seriesId ?? "")) ||
    chapters !== recording.chapters.join(", ") ||
    topics !== recording.topics.join(", ") ||
    listed !== recording.website.listed;

  const splitTags = (value: string) => value.split(",").map((tag) => tag.trim()).filter(Boolean);

  async function saveDetails(): Promise<boolean> {
    if (!dirty) return true;
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
        toast.success("Saved.");
        router.refresh();
      }
    });

  const publish = () =>
    startTransition(async () => {
      if (!toApp && !toWebsite) {
        toast.error("Choose where to publish it.");
        return;
      }
      if (!(await saveDetails())) return;
      if (poster !== (recording.chosenPosterUrl ?? recording.autoPosterUrl ?? null)) {
        const chosen = await chooseThumbnailAction({ recordingId: recording.id, url: poster });
        if (!chosen.ok) {
          toast.error(chosen.error);
          return;
        }
      }
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
      toast.success(published ? "Updated." : "Published.");
      router.refresh();
    });

  const unpublish = () =>
    startTransition(async () => {
      const result = await unpublishRecordingAction(recording.id);
      setConfirmUnpublish(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Unpublished. The recording is still saved.");
      router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      const result = await deleteRecordingAction(recording.id);
      if (!result.ok) {
        toast.error(result.error);
        setConfirmDelete(false);
        return;
      }
      toast.success("Recording deleted.");
      router.push("/dashboard/live-streaming/recordings");
    });

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
      toast.success(`Trimmed. It now runs ${formatClock(result.data.durationSec)}.`);
      router.refresh();
    });

  const retry = () =>
    startTransition(async () => {
      const result = await retryRecordingAction(recording.id);
      if (!result.ok) toast.error(result.error);
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <RecordingPhaseBadge phase={phase} label={recording.phase.label} className="w-fit" />
          <h2 className="font-heading text-2xl font-bold leading-tight sm:text-3xl">{recording.title}</h2>
          <p className="text-sm text-muted-foreground">
            {recordedOn}
            {recording.durationSec ? ` · ${formatClock(recording.durationSec)}` : ""}
          </p>
        </div>
        {isAdmin ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="size-11" >
              <MoreHorizontal className="size-5" aria-hidden />
              <span className="sr-only">More actions</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-red-700 dark:text-red-300">
                <Trash2 className="mr-2 size-4" aria-hidden />
                Delete recording…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {phase === "needs_attention" || phase === "preparing" || phase === "recording" ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 text-sm",
            phase === "needs_attention"
              ? "border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10"
              : "border-border bg-muted/40",
          )}
          role={phase === "needs_attention" ? "alert" : "status"}
        >
          <p>{recording.phase.detail}</p>
          {phase === "needs_attention" && isAdmin && recording.segmentCount > 0 ? (
            <Button variant="outline" size="sm" onClick={retry} disabled={pending}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-5">
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
            <div className="flex aspect-video items-center justify-center rounded-2xl bg-muted text-sm text-muted-foreground">
              {phase === "recording" ? "The preview appears when the service ends." : "No video to preview yet."}
            </div>
          )}

          {canEdit && recording.status === "ready" ? (
            <section className="rounded-2xl border border-border">
              <button
                type="button"
                onClick={() => setTrimOpen((open) => !open)}
                aria-expanded={trimOpen}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="flex items-center gap-2 font-semibold">
                  <Scissors className="size-4 text-accent" aria-hidden />
                  Trim the beginning or end
                </span>
                <ChevronDown className={cn("size-4 transition-transform", trimOpen && "rotate-180")} aria-hidden />
              </button>
              {trimOpen ? (
                <div className="flex flex-col gap-4 border-t border-border p-4">
                  <p className="text-sm text-muted-foreground">
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
                    <span className="text-xs text-muted-foreground">
                      FaithForm keeps a few extra seconds at each edge rather than cut into your service.
                    </span>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {canEdit && thumbnails.length > 0 ? (
            <section className="flex flex-col gap-3">
              <div>
                <h3 className="font-semibold">Thumbnail</h3>
                <p className="text-sm text-muted-foreground">Chosen automatically. Pick another if you like.</p>
              </div>
              <div role="radiogroup" aria-label="Thumbnail" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
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
                <p className="text-xs text-muted-foreground">Your custom artwork is used in the app instead.</p>
              ) : null}
            </section>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <fieldset disabled={!canEdit || pending} className="flex flex-col gap-4">
            <legend className="sr-only">Details</legend>
            <Field id="rec-title" label="Title">
              <Input id="rec-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
            </Field>
            <Field id="rec-speaker" label="Speaker" optional>
              <Input
                id="rec-speaker"
                value={speaker}
                onChange={(event) => setSpeaker(event.target.value)}
                placeholder="Pastor John"
                maxLength={120}
              />
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
            <Field id="rec-description" label="Description" optional>
              <Textarea
                id="rec-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                maxLength={2000}
              />
            </Field>
          </fieldset>

          <section className="flex flex-col gap-3 rounded-2xl border border-border p-4">
            <h3 className="font-semibold">{published ? "Published" : "Visible in"}</h3>
            {published ? (
              <ul className="flex flex-col gap-1.5 text-sm">
                {recording.app.published ? (
                  <li className="inline-flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="size-4" aria-hidden /> Faithful app
                  </li>
                ) : null}
                {recording.website.published ? (
                  <li className="inline-flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="size-4" aria-hidden /> Church website
                  </li>
                ) : null}
              </ul>
            ) : null}
            <fieldset disabled={!canEdit || pending} className="flex flex-col gap-2">
              <legend className="sr-only">Where to publish</legend>
              {/* Already-published destinations stay checked: taking something
                  down is Unpublish, a separate and deliberate act. */}
              <Check
                checked={toApp}
                onChange={setToApp}
                disabled={recording.app.published}
                icon={<Smartphone className="size-4" aria-hidden />}
                label="Faithful app"
              />
              <Check
                checked={toWebsite}
                onChange={setToWebsite}
                disabled={recording.website.published}
                icon={<Globe className="size-4" aria-hidden />}
                label="Church website"
              />
            </fieldset>

            <button
              type="button"
              onClick={() => setMoreOpen((open) => !open)}
              aria-expanded={moreOpen}
              className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline dark:text-accent"
            >
              More options
              <ChevronDown className={cn("size-4 transition-transform", moreOpen && "rotate-180")} aria-hidden />
            </button>
            {moreOpen ? (
              <fieldset disabled={!canEdit || pending} className="flex flex-col gap-4 border-t border-border pt-4">
                <legend className="sr-only">More options</legend>
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
                  hint="Sends one notification to the app when it's first published."
                />
                <Check
                  checked={listed}
                  onChange={setListed}
                  label="List it on your website"
                  hint="Off: only people with the link can find it."
                />
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
                {artworkSlot}
              </fieldset>
            ) : null}

            {isAdmin ? (
              <div className="flex flex-col gap-2 pt-2">
                {!published ||
                (toApp && !recording.app.published) ||
                (toWebsite && !recording.website.published) ||
                (recording.app.published && audience !== recording.app.visibility) ? (
                  <Button
                    size="lg"
                    onClick={publish}
                    disabled={pending || !recording.canPublish || (!toApp && !toWebsite)}
                    className="gap-2"
                  >
                    {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                    {published ? "Update publishing" : "Publish"}
                  </Button>
                ) : dirty || poster !== (recording.chosenPosterUrl ?? recording.autoPosterUrl ?? null) ? (
                  <Button size="lg" onClick={publish} disabled={pending} className="gap-2">
                    {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                    Save changes
                  </Button>
                ) : null}
                {!recording.canPublish && recording.publishBlockedReason && !published ? (
                  <p className="text-sm text-muted-foreground">{recording.publishBlockedReason}</p>
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
                    <Button variant="ghost" onClick={() => setConfirmUnpublish(true)} disabled={pending}>
                      Unpublish
                    </Button>
                  </div>
                ) : dirty ? (
                  <Button variant="ghost" onClick={save} disabled={pending}>
                    Save without publishing
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">A church admin can publish this recording.</p>
            )}
          </section>

          {stats && (stats.live > 0 || stats.replay > 0) ? (
            <p className="text-sm text-muted-foreground">
              {stats.live > 0 ? `${stats.live} watched live` : null}
              {stats.live > 0 && stats.replay > 0 ? " · " : null}
              {stats.replay > 0 ? `${stats.replay} watched the replay` : null}
            </p>
          ) : null}

          <Link href="/dashboard/live-streaming/recordings" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            ← All recordings
          </Link>
        </div>
      </div>

      <Dialog open={confirmUnpublish} onOpenChange={(open) => !pending && setConfirmUnpublish(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unpublish this recording?</DialogTitle>
            <DialogDescription>
              It will be removed from the Faithful app and your website. The recording itself stays saved, and you can
              publish it again any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmUnpublish(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={unpublish} disabled={pending}>
              Unpublish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={(open) => !pending && setConfirmDelete(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this recording permanently?</DialogTitle>
            <DialogDescription>
              The video is removed from FaithForm, the app and your website, and can&apos;t be recovered. If you only
              want to hide it, unpublish it instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={pending}>
              Keep it
            </Button>
            <Button onClick={remove} disabled={pending} className="gap-2 bg-red-600 text-white hover:bg-red-700 hover:text-white">
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
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
    <label className="flex cursor-pointer items-start gap-3 rounded-lg py-1">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
      />
      <span className="flex flex-col">
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          {icon}
          {label}
        </span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
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
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="numeric"
          placeholder="0:00"
          className="font-mono tabular-nums"
        />
        <Button type="button" variant="outline" size="sm" onClick={onUseCurrent}>
          Use video time
        </Button>
      </div>
    </div>
  );
}
