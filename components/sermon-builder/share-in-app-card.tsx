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
  appShareReadiness,
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
 * Sharing this sermon's notes and slides in the FaithForm app as one action.
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
  const anythingShared = notesShared || slidesShared;
  const notesReadiness = sermonShareReadiness(sermon);
  const slidesReadiness = slidesShareReadiness(sermon);
  const bundleReadiness = appShareReadiness(sermon);
  const canPublishNotes = notesReadiness.ready || notesShared;
  const canPublishSlides = slidesReadiness.ready || slidesShared;
  const canPublish = canPublishNotes || canPublishSlides;
  const isSimple = (sermon.kind ?? "advanced") === "simple";

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [audience, setAudience] = useState<Audience>(
    toAudience(
      notesShared ? sermon.mobile_visibility : presentation?.mobile_visibility,
      "members",
    ),
  );
  const [summary, setSummary] = useState(sermon.mobile_summary ?? "");
  const [preachedOn, setPreachedOn] = useState(
    sermon.mobile_preached_on ?? sermon.sermon_date ?? "",
  );

  if (!featuresEnabled) return null;

  const shareInApp = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const errors: string[] = [];
      let notesOk = false;
      let slidesOk = false;

      if (canPublishNotes) {
        const result = await shareSermonInAppAction({
          sermonId: sermon.id,
          visibility: audience,
          summary: summary.trim() || null,
          preachedOn: preachedOn || null,
        });
        if (result.error) errors.push(result.error);
        else notesOk = true;
      }

      if (canPublishSlides) {
        const result = await sharePresentationInAppAction({
          sermonId: sermon.id,
          visibility: audience,
        });
        if (result.error) errors.push(result.error);
        else slidesOk = true;
      }

      if (!notesOk && !slidesOk) {
        setError(errors[0] ?? "We couldn't share this in the FaithForm app just now. Please try again.");
        return;
      }
      if (errors.length > 0) {
        setError(errors[0] ?? null);
      }
      setSuccess(
        anythingShared
          ? "Updated in the FaithForm app."
          : "Shared in the FaithForm app.",
      );
    });
  };

  const unshareInApp = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const errors: string[] = [];
      if (notesShared) {
        const result = await unshareSermonInAppAction(sermon.id);
        if (result.error) errors.push(result.error);
      }
      if (slidesShared) {
        const result = await unsharePresentationInAppAction(sermon.id);
        if (result.error) errors.push(result.error);
      }
      if (errors.length > 0) {
        setError(errors[0] ?? null);
        return;
      }
      setSuccess("Removed from the FaithForm app.");
    });
  };

  const notesSince = formatDay(sermon.mobile_published_at);
  const slidesSince = formatDay(presentation?.published_at);
  const audienceLabel = sermonAudienceLabel(
    notesShared
      ? sermon.mobile_visibility
      : (presentation?.mobile_visibility ?? null),
  );

  const parts: string[] = [];
  if (notesShared) {
    parts.push(notesSince ? `notes since ${notesSince}` : "notes");
  }
  if (slidesShared && presentation) {
    const slideBits = [`slides · version ${presentation.version}`];
    if (slidesSince) slideBits.push(`since ${slidesSince}`);
    slideBits.push(`${presentation.page_count} slides`);
    parts.push(slideBits.join(" · "));
  }

  return (
    <Card id={SHARE_IN_APP_ANCHOR} className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="size-4 text-accent" strokeWidth={1.75} />
          Share in the FaithForm app
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Churchgoers see the notes (title, scripture, outline and discussion
          questions) and the slide deck together. Your manuscript and your own
          notes are never shared. Each slide publish saves a new version — later
          edits to the draft do not change what members already opened.
        </p>
        <p className="text-sm" role="status">
          {anythingShared ? (
            <>
              <span className="font-medium">In the app</span>
              {audienceLabel && <> · {audienceLabel}</>}
              {parts.length > 0 && (
                <span className="text-muted-foreground"> · {parts.join(" · ")}</span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">Not in the app yet.</span>
          )}
        </p>

        {!canShare ? (
          <p className="text-sm text-muted-foreground">{ONLY_ADMINS_CAN_SHARE}</p>
        ) : !bundleReadiness.ready && !anythingShared ? (
          <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border p-4">
            <p className="font-medium">{bundleReadiness.title}</p>
            <p className="text-sm text-muted-foreground">{bundleReadiness.message}</p>
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
              name={`app-audience-${sermon.id}`}
              value={audience}
              onChange={setAudience}
              legend="Who can see this"
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
            {!notesReadiness.ready && slidesReadiness.ready && (
              <p className="text-sm text-muted-foreground">
                Notes will publish too once the lesson has an outline, or a
                title and scripture.
              </p>
            )}
            {notesReadiness.ready && !slidesReadiness.ready && (
              <p className="text-sm text-muted-foreground">
                Slides will publish too once the deck has a title and scripture
                or lesson points.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {canPublish && (
                <Button type="button" onClick={shareInApp} disabled={pending}>
                  {pending
                    ? "Sharing…"
                    : anythingShared
                      ? "Update in the app"
                      : "Share in the FaithForm app"}
                </Button>
              )}
              {anythingShared && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={unshareInApp}
                  disabled={pending}
                >
                  Remove from the app
                </Button>
              )}
            </div>
          </>
        )}

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
