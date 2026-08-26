"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  getFaithfulPublicationHistory,
  getFaithfulPublishingState,
  getPosterChoicesFor,
  previewFaithfulVisibility,
  publishMediaToFaithful,
  unpublishMediaFromFaithful,
} from "@/app/dashboard/live-streaming/faithful-actions";
import type { AuditEntry, PosterChoice, PublishableItem } from "@/lib/media/v1/publication";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Publishing a service to the Faithful apps.
 *
 * ## Why publishing is a separate, explicit act
 *
 * Everything a church streams lands here automatically, and almost none of it
 * should go to a congregation's phones without someone looking at it first — a
 * test broadcast, a rehearsal, a service that ran badly, a recording that
 * captured the wrong forty minutes. So the default is invisible and the button
 * is the decision.
 *
 * ## Why unpublish and revoke are different buttons
 *
 * Unpublishing takes something out of the app. Revoking additionally refuses to
 * renew a playback capability, which is what stops someone who is *watching
 * right now* — within about a minute, at their next refresh, rather than at the
 * end of the sermon. Revoking is the one to press when something is wrong
 * rather than merely finished, so it asks a different question and says what it
 * will do to anyone mid-service.
 */

const STATE_LABELS: Record<string, { label: string; tone: "live" | "on" | "off" | "wait" }> = {
  draft: { label: "Not in Faithful", tone: "off" },
  scheduled: { label: "Scheduled", tone: "on" },
  live: { label: "Live now", tone: "live" },
  awaiting_recording: { label: "Waiting for recording", tone: "wait" },
  processing: { label: "Processing", tone: "wait" },
  ready: { label: "Ready to publish", tone: "wait" },
  needs_conversion: { label: "Can't be played on phones", tone: "off" },
  unverified: { label: "Checking the file…", tone: "wait" },
  published: { label: "In Faithful", tone: "on" },
  unpublished: { label: "Removed from Faithful", tone: "off" },
  revoked: { label: "Access revoked", tone: "off" },
  cancelled: { label: "Cancelled", tone: "off" },
};

const VISIBILITIES = [
  { value: "public", label: "Anyone using Faithful" },
  { value: "followers", label: "People following this church" },
  { value: "members", label: "People who have joined" },
] as const;

type Visibility = (typeof VISIBILITIES)[number]["value"];

function StateBadge({ state }: { state: string }) {
  const entry = STATE_LABELS[state] ?? { label: state, tone: "off" as const };
  const className =
    entry.tone === "live"
      ? "bg-destructive/15 text-destructive"
      : entry.tone === "on"
        ? "bg-accent/15 text-accent"
        : entry.tone === "wait"
          ? "bg-muted text-muted-foreground"
          : "bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={className}>
      {entry.label}
    </Badge>
  );
}

function formatWhen(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function FaithfulPublishingPanel() {
  const [items, setItems] = useState<PublishableItem[]>([]);
  const [posters, setPosters] = useState<PosterChoice[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();

  const [publishTarget, setPublishTarget] = useState<PublishableItem | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{
    item: PublishableItem;
    revoke: boolean;
  } | null>(null);
  const [historyFor, setHistoryFor] = useState<{
    item: PublishableItem;
    entries: AuditEntry[];
  } | null>(null);
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof previewFaithfulVisibility>
  > | null>(null);

  const refresh = useCallback(() => {
    startTransition(async () => {
      const result = await getFaithfulPublishingState();
      if (result.ok) {
        setItems(result.data.items);
        setPosters(result.data.posters);
        setConfigured(result.data.playbackConfigured);
      } else {
        toast.error(result.error);
      }
      setLoaded(true);
    });
  }, []);

  useEffect(refresh, [refresh]);

  if (!loaded) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Faithful app</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Faithful app</CardTitle>
        <CardDescription>
          Nothing appears in the Faithful app until you publish it here. A
          service you publish is visible to the people you choose; a recording
          has to finish processing first.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!configured && (
          <div
            role="status"
            className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground"
          >
            Publishing to Faithful isn&apos;t set up on this FaithForm
            installation yet. Ask whoever runs it to finish the setup — the steps
            are in the deployment runbook.
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await previewFaithfulVisibility();
                if (result.ok) setPreview(result);
                else toast.error(result.error);
              })
            }
          >
            Preview what visitors see
          </Button>
          <Button variant="outline" size="sm" disabled={pending} onClick={refresh}>
            Refresh
          </Button>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing to publish yet. Schedule a service or stream one, and it will
            appear here.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => {
              const duration = formatDuration(item.durationSeconds);
              // `published` is what the church intended; `mobilePlayable` is
              // whether Faithful can honour it. A recording that was published
              // and has since been proved unplayable is not in the app, so the
              // row must not claim it is.
              const isPublished =
                (item.state === "published" || item.state === "live") && item.mobilePlayable;
              return (
                <li
                  key={`${item.kind}:${item.id}`}
                  className="flex flex-wrap items-start justify-between gap-3 py-3"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{item.title}</span>
                      <StateBadge state={item.state} />
                      <Badge variant="outline" className="text-[11px]">
                        {item.kind === "live" ? "Service" : "Recording"}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatWhen(item.occurredAt)}
                      {duration ? ` · ${duration}` : ""}
                      {item.publishedAt && isPublished
                        ? ` · published ${formatWhen(item.publishedAt)}`
                        : ""}
                    </span>

                    {/*
                      Why it can't go in the app, in the row rather than behind
                      a tooltip. A pastor looking at a service that will not
                      publish needs to know whether to re-record it, wait, or
                      call someone — and a disabled button with no explanation
                      answers none of those.
                    */}
                    {!item.mobilePlayable && item.renditionExplanation && (
                      <span className="max-w-prose text-xs text-muted-foreground">
                        {item.renditionExplanation}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await getFaithfulPublicationHistory({
                            kind: item.kind,
                            id: item.id,
                          });
                          if (result.ok) setHistoryFor({ item, entries: result.data });
                          else toast.error(result.error);
                        })
                      }
                    >
                      History
                    </Button>

                    {item.canPublish && (
                      <Button
                        size="sm"
                        disabled={pending || !configured}
                        onClick={() =>
                          startTransition(async () => {
                            const choices = await getPosterChoicesFor({
                              kind: item.kind,
                              id: item.id,
                            });
                            if (choices.ok) setPosters(choices.data);
                            setPublishTarget(item);
                          })
                        }
                      >
                        {isPublished ? "Change" : "Publish"}
                      </Button>
                    )}

                    {isPublished && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => setConfirmTarget({ item, revoke: false })}
                        >
                          Remove
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => setConfirmTarget({ item, revoke: true })}
                        >
                          Revoke
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <PublishDialog
        item={publishTarget}
        posters={posters}
        onClose={() => setPublishTarget(null)}
        onDone={() => {
          setPublishTarget(null);
          refresh();
        }}
      />

      <ConfirmDialog
        target={confirmTarget}
        onClose={() => setConfirmTarget(null)}
        onDone={() => {
          setConfirmTarget(null);
          refresh();
        }}
      />

      <HistoryDialog value={historyFor} onClose={() => setHistoryFor(null)} />

      <PreviewDialog value={preview} onClose={() => setPreview(null)} />
    </Card>
  );
}

function PublishDialog({
  item,
  posters,
  onClose,
  onDone,
}: {
  item: PublishableItem | null;
  posters: PosterChoice[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!item) return;
    setVisibility(
      item.visibility === "none" ? "public" : (item.visibility as Visibility),
    );
    setPosterUrl(item.posterUrl);
    setSummary(item.summary ?? "");
  }, [item]);

  if (!item) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Publish to Faithful</DialogTitle>
          <DialogDescription>
            {item.title} — {item.kind === "live" ? "live service" : "recording"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-foreground">Who can see it</legend>
            {VISIBILITIES.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="faithful-visibility"
                  value={option.value}
                  checked={visibility === option.value}
                  onChange={() => setVisibility(option.value)}
                  className="size-4"
                />
                {option.label}
              </label>
            ))}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-foreground">Poster</legend>
            <p className="text-xs text-muted-foreground">
              Choose one of this church&apos;s own images. Faithful shows a
              typographic card when there is none.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="faithful-poster"
                checked={posterUrl === null}
                onChange={() => setPosterUrl(null)}
                className="size-4"
              />
              No poster
            </label>
            {posters.map((choice) => (
              <label key={choice.url} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="faithful-poster"
                  checked={posterUrl === choice.url}
                  onChange={() => setPosterUrl(choice.url)}
                  className="size-4"
                />
                {choice.label}
              </label>
            ))}
          </fieldset>

          {item.kind === "recording" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="faithful-summary">What this service was about</Label>
              <Textarea
                id="faithful-summary"
                value={summary}
                maxLength={2000}
                rows={3}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="Optional. Shown under the title in the app."
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await publishMediaToFaithful({
                  kind: item.kind,
                  id: item.id,
                  visibility,
                  posterUrl,
                  summary: item.kind === "recording" ? summary : null,
                });
                if (result.ok) {
                  toast.success("Published to Faithful.");
                  onDone();
                } else {
                  toast.error(result.error);
                }
              })
            }
          >
            {pending ? "Publishing…" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({
  target,
  onClose,
  onDone,
}: {
  target: { item: PublishableItem; revoke: boolean } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  if (!target) return null;

  const { item, revoke } = target;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {revoke ? "Revoke access to this?" : "Remove this from Faithful?"}
          </DialogTitle>
          <DialogDescription>
            {revoke ? (
              <>
                {item.title} will disappear from the app, <strong>and anyone
                watching it right now will stop within about a minute.</strong>{" "}
                Use this when something is wrong, not when a service is simply
                over.
              </>
            ) : (
              <>
                {item.title} will disappear from the app. Anyone already watching
                will finish what they are watching. Nothing is deleted, and you
                can publish it again later.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await unpublishMediaFromFaithful({
                  kind: item.kind,
                  id: item.id,
                  revoke,
                });
                if (result.ok) {
                  toast.success(revoke ? "Access revoked." : "Removed from Faithful.");
                  onDone();
                } else {
                  toast.error(result.error);
                }
              })
            }
          >
            {revoke ? "Revoke access" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ACTION_LABELS: Record<string, string> = {
  published: "Published",
  unpublished: "Removed",
  visibility_changed: "Changed who can see it",
  revoked: "Revoked access",
  poster_changed: "Changed the poster",
};

function HistoryDialog({
  value,
  onClose,
}: {
  value: { item: PublishableItem; entries: AuditEntry[] } | null;
  onClose: () => void;
}) {
  if (!value) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publishing history</DialogTitle>
          <DialogDescription>{value.item.title}</DialogDescription>
        </DialogHeader>

        {value.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This has never been published to Faithful.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {value.entries.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-0.5 py-2">
                <span className="text-foreground">
                  {ACTION_LABELS[entry.action] ?? entry.action}
                  {entry.newVisibility ? ` · ${entry.newVisibility}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatWhen(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewDialog({
  value,
  onClose,
}: {
  value: Awaited<ReturnType<typeof previewFaithfulVisibility>> | null;
  onClose: () => void;
}) {
  if (!value || !value.ok) return null;
  const { live, archive } = value.data;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>What visitors see</DialogTitle>
          <DialogDescription>
            Read through the same projection the app uses, as someone with no
            relationship to this church. People who follow or have joined may see
            more.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 text-sm">
          <div>
            <p className="font-medium text-foreground">Live now</p>
            {live ? (
              <p className="text-muted-foreground">
                {live.title} — {live.state}
              </p>
            ) : (
              <p className="text-muted-foreground">
                Nothing. The app shows no live area at all.
              </p>
            )}
          </div>

          <div>
            <p className="font-medium text-foreground">Archive</p>
            {archive.length === 0 ? (
              <p className="text-muted-foreground">No published recordings.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-muted-foreground">
                {archive.map((item) => (
                  <li key={item.mediaId}>
                    {item.title} · {formatWhen(item.publishedAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
