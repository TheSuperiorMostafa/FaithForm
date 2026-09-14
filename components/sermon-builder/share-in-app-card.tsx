"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Smartphone } from "lucide-react";

import {
  sharePresentationInAppAction,
  shareSermonInAppAction,
  unsharePresentationInAppAction,
  unshareSermonInAppAction,
} from "@/app/dashboard/sermon-builder/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActivePresentationVersion } from "@/lib/sermons/v1/presentation";
import {
  isPresentationShared,
  isSermonShared,
  LESSON_ANCHOR,
  ONLY_ADMINS_CAN_SHARE,
  SHARE_IN_APP_ANCHOR,
  sermonAudienceLabel,
  sermonShareReadiness,
  slidesShareReadiness,
} from "@/lib/sermons/v1/share-rules";
import type { Sermon } from "@/types/sermon";

type Audience = "followers" | "members";

const AUDIENCES: Array<{ value: Audience; hint: string }> = [
  {
    value: "followers",
    hint: "Everyone who has added your church in the FaithForm app, including members.",
  },
  {
    value: "members",
    hint: "Only people who have joined your church in the FaithForm app.",
  },
];

function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function toAudience(
  visibility: string | null | undefined,
  fallback: Audience,
): Audience {
  if (visibility === "members") return "members";
  if (visibility === "public" || visibility === "followers") return "followers";
  return fallback;
}

/**
 * Sharing sermon notes and slides in the FaithForm app.
 *
 * Notes stay a live projection of the outline; slides insert an immutable
 * version each time you publish. Hidden when Sermon Builder or Member App is off.
 */
export function ShareInAppCard({
  sermon,
  canShare,
  featuresEnabled = true,
  presentation = null,
}: {
  sermon: Sermon;
  canShare: boolean;
  /** Both `sermon_builder` and `member_app` must be on. */
  featuresEnabled?: boolean;
  presentation?: ActivePresentationVersion | null;
}) {
  const notesShared = isSermonShared(sermon);
  const slidesShared = Boolean(
    presentation && isPresentationShared(presentation),
  );
  const notesReadiness = sermonShareReadiness(sermon);
  const slidesReadiness = slidesShareReadiness(sermon);
  const isSimple = (sermon.kind ?? "advanced") === "simple";

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [notesAudience, setNotesAudience] = useState<Audience>(
    toAudience(sermon.mobile_visibility, "members"),
  );
  const [slidesAudience, setSlidesAudience] = useState<Audience>(
    toAudience(presentation?.mobile_visibility, "members"),
  );
  const [summary, setSummary] = useState(sermon.mobile_summary ?? "");
  const [preachedOn, setPreachedOn] = useState(
    sermon.mobile_preached_on ?? sermon.sermon_date ?? "",
  );

  if (!featuresEnabled) return null;

  const shareNotes = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await shareSermonInAppAction({
        sermonId: sermon.id,
        visibility: notesAudience,
        summary: summary.trim() || null,
        preachedOn: preachedOn || null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess(
        notesShared
          ? "Notes updated in the FaithForm app."
          : "Notes shared in the FaithForm app.",
      );
    });
  };

  const unshareNotes = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await unshareSermonInAppAction(sermon.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess("Notes removed from the FaithForm app.");
    });
  };

  const shareSlides = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await sharePresentationInAppAction({
        sermonId: sermon.id,
        visibility: slidesAudience,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess(
        slidesShared
          ? "New slide version published to the FaithForm app."
          : "Slides published to the FaithForm app.",
      );
    });
  };

  const unshareSlides = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await unsharePresentationInAppAction(sermon.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess("Slides removed from the FaithForm app.");
    });
  };

  const notesSince = formatDay(sermon.mobile_published_at);
  const notesAudienceLabel = sermonAudienceLabel(sermon.mobile_visibility);
  const slidesSince = formatDay(presentation?.published_at);
  const slidesAudienceLabel = sermonAudienceLabel(
    presentation?.mobile_visibility ?? null,
  );

  return (
    <Card id={SHARE_IN_APP_ANCHOR} className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="size-4 text-accent" strokeWidth={1.75} />
          Share in the FaithForm app
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-8">
        <section className="flex flex-col gap-4" aria-labelledby={`notes-${sermon.id}`}>
          <div className="flex flex-col gap-1">
            <h3 id={`notes-${sermon.id}`} className="text-sm font-semibold">
              Notes
            </h3>
            <p className="text-sm text-muted-foreground">
              Churchgoers see the title, scripture, outline and discussion
              questions. Your manuscript and your own notes are never shared.
            </p>
            <p className="text-sm" role="status">
              {notesShared ? (
                <>
                  <span className="font-medium">In the app</span>
                  {notesAudienceLabel && <> · {notesAudienceLabel}</>}
                  {notesSince && (
                    <span className="text-muted-foreground">
                      {" "}
                      · since {notesSince}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">Notes not in the app yet.</span>
              )}
            </p>
          </div>

          {!canShare ? (
            <p className="text-sm text-muted-foreground">{ONLY_ADMINS_CAN_SHARE}</p>
          ) : !notesReadiness.ready && !notesShared ? (
            <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border p-4">
              <p className="font-medium">{notesReadiness.title}</p>
              <p className="text-sm text-muted-foreground">{notesReadiness.message}</p>
              {isSimple && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    nativeButton={false}
                    render={<a href={`#${LESSON_ANCHOR}`}>Create the lesson</a>}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={
                      <Link href={`/dashboard/sermon-builder/${sermon.id}/edit`}>
                        Edit title and scripture
                      </Link>
                    }
                  />
                </div>
              )}
            </div>
          ) : (
            <>
              <AudienceFieldset
                name={`notes-audience-${sermon.id}`}
                value={notesAudience}
                onChange={setNotesAudience}
                legend="Who can read the notes"
              />
              <div className="flex flex-col gap-2">
                <Label htmlFor={`preached-${sermon.id}`}>Preached on</Label>
                <Input
                  id={`preached-${sermon.id}`}
                  type="date"
                  value={preachedOn}
                  onChange={(e) => setPreachedOn(e.target.value)}
                  className="w-fit tabular-nums"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`summary-${sermon.id}`}>
                  A line for the list (optional)
                </Label>
                <Textarea
                  id={`summary-${sermon.id}`}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="What this sermon was about, in a sentence."
                  rows={2}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(notesReadiness.ready || notesShared) && (
                  <Button type="button" onClick={shareNotes} disabled={pending}>
                    {pending
                      ? "Saving…"
                      : notesShared
                        ? "Update notes"
                        : "Share notes"}
                  </Button>
                )}
                {notesShared && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={unshareNotes}
                    disabled={pending}
                  >
                    Remove notes
                  </Button>
                )}
              </div>
            </>
          )}
        </section>

        <section
          className="flex flex-col gap-4 border-t border-border pt-6"
          aria-labelledby={`slides-${sermon.id}`}
        >
          <div className="flex flex-col gap-1">
            <h3 id={`slides-${sermon.id}`} className="text-sm font-semibold">
              Slides
            </h3>
            <p className="text-sm text-muted-foreground">
              Publish slides to app as a read-only deck. Each publish saves a new
              version — later edits to the draft do not change what members
              already opened.
            </p>
            <p className="text-sm" role="status">
              {slidesShared && presentation ? (
                <>
                  <span className="font-medium">Slides in the app</span>
                  {slidesAudienceLabel && <> · {slidesAudienceLabel}</>}
                  <span className="text-muted-foreground">
                    {" "}
                    · version {presentation.version}
                    {slidesSince ? ` · since ${slidesSince}` : ""}
                    {` · ${presentation.page_count} slides`}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  Slides not in the app yet.
                </span>
              )}
            </p>
          </div>

          {!canShare ? (
            <p className="text-sm text-muted-foreground">{ONLY_ADMINS_CAN_SHARE}</p>
          ) : !slidesReadiness.ready && !slidesShared ? (
            <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border p-4">
              <p className="font-medium">{slidesReadiness.title}</p>
              <p className="text-sm text-muted-foreground">
                {slidesReadiness.message}
              </p>
            </div>
          ) : (
            <>
              <AudienceFieldset
                name={`slides-audience-${sermon.id}`}
                value={slidesAudience}
                onChange={setSlidesAudience}
                legend="Who can see the slides"
              />
              <div className="flex flex-wrap items-center gap-2">
                {(slidesReadiness.ready || slidesShared) && (
                  <Button type="button" onClick={shareSlides} disabled={pending}>
                    {pending
                      ? "Publishing…"
                      : slidesShared
                        ? "Publish new slide version"
                        : "Publish slides to app"}
                  </Button>
                )}
                {slidesShared && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={unshareSlides}
                    disabled={pending}
                  >
                    Remove slides
                  </Button>
                )}
              </div>
            </>
          )}
        </section>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p
            className="text-sm font-medium text-green-700 dark:text-green-300"
            role="status"
          >
            {success}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AudienceFieldset({
  name,
  value,
  onChange,
  legend,
}: {
  name: string;
  value: Audience;
  onChange: (value: Audience) => void;
  legend: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium leading-none">{legend}</legend>
      <div className="flex flex-col gap-1">
        {AUDIENCES.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">
                {sermonAudienceLabel(option.value)}
              </span>
              <span className="block text-xs text-muted-foreground">
                {option.hint}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
