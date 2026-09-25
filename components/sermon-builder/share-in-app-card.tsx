"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Smartphone, X } from "lucide-react";
import { toast } from "sonner";

import {
  sharePresentationInAppAction,
  shareSermonInAppAction,
  unsharePresentationInAppAction,
  unshareSermonInAppAction,
} from "@/app/dashboard/sermon-builder/actions";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActivePresentationVersion } from "@/lib/sermons/v1/presentation";
import {
  appShareReadiness,
  isPresentationShared,
  isSermonShared,
  sermonAudienceLabel,
  sermonShareReadiness,
  slidesShareReadiness,
} from "@/lib/sermons/v1/share-rules";
import type { Sermon } from "@/types/sermon";

type Audience = "followers" | "members";

const AUDIENCES: Array<{ value: Audience; hint: string }> = [
  {
    value: "followers",
    hint: "Everyone who has added your church in the app, members included.",
  },
  {
    value: "members",
    hint: "Only people who have joined your church in the app.",
  },
];

const PUBLISH_FAILED = "We couldn't publish this to the app just now. Please try again.";

function toAudience(
  visibility: string | null | undefined,
  fallback: Audience,
): Audience {
  if (visibility === "members") return "members";
  if (visibility === "public" || visibility === "followers") return "followers";
  return fallback;
}

/** What is in the app for this sermon right now: notes, slides, or neither. */
export function appShareState(
  sermon: Sermon,
  presentation: ActivePresentationVersion | null,
) {
  const notesShared = isSermonShared(sermon);
  const slidesShared = Boolean(presentation && isPresentationShared(presentation));
  return {
    notesShared,
    slidesShared,
    inApp: notesShared || slidesShared,
    audienceLabel: sermonAudienceLabel(
      notesShared ? sermon.mobile_visibility : (presentation?.mobile_visibility ?? null),
    ),
  };
}

/**
 * "Publish to the app": the sermon's notes (title, scripture, lesson outline,
 * discussion questions) and its slides go into the app together, as one
 * action. Notes stay a live projection of the lesson; slides publish a new
 * immutable version each time, so later edits never change what members
 * already opened. Church admins only; the server enforces the same rule.
 */
export function PublishToAppButton({
  sermon,
  presentation = null,
}: {
  sermon: Sermon;
  presentation?: ActivePresentationVersion | null;
}) {
  const router = useRouter();
  const { notesShared, slidesShared, inApp } = appShareState(sermon, presentation);
  const notesReadiness = sermonShareReadiness(sermon);
  const slidesReadiness = slidesShareReadiness(sermon);
  const bundleReadiness = appShareReadiness(sermon);
  const canPublishNotes = notesReadiness.ready || notesShared;
  const canPublishSlides = slidesReadiness.ready || slidesShared;
  const canPublish = canPublishNotes || canPublishSlides;

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState<Audience>(
    toAudience(
      notesShared ? sermon.mobile_visibility : presentation?.mobile_visibility,
      "members",
    ),
  );
  const [summary, setSummary] = useState(sermon.mobile_summary ?? "");
  // "Preached on" is the sermon date unless someone changes it under More
  // options: the date question was already answered when the sermon was made.
  const [preachedOn, setPreachedOn] = useState(
    sermon.mobile_preached_on ?? sermon.sermon_date ?? "",
  );

  const publish = () => {
    setError(null);
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
        setError(errors[0] ?? PUBLISH_FAILED);
        return;
      }
      setOpen(false);
      router.refresh();
      if (errors.length > 0) {
        toast.warning(
          `"${sermon.title}" is in the app, but part of it didn't go through. ${errors[0]}`,
        );
        return;
      }
      toast.success(
        inApp
          ? `"${sermon.title}" is updated in the app.`
          : `"${sermon.title}" is published to the app.`,
      );
    });
  };

  if (!canPublish) {
    return (
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <Button size="lg" disabled>
          <Smartphone aria-hidden className="size-5" />
          Publish to the app
        </Button>
        {!bundleReadiness.ready && (
          <p className="max-w-xs text-sm text-muted-foreground sm:text-right">
            {bundleReadiness.message}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <Button
        size="lg"
        variant={inApp ? "outline" : "default"}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Smartphone aria-hidden className="size-5" />
        {inApp ? "Update in the app" : "Publish to the app"}
      </Button>

      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent showClose={!pending} className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{inApp ? "Update in the app" : "Publish to the app"}</DialogTitle>
            <DialogDescription className="text-[15px]">
              People see the title, the scripture, the lesson and its discussion
              questions, and the slides. Your own notes are never shared.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 overflow-y-auto px-6 py-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[15px] font-semibold">Who can see it</legend>
              {AUDIENCES.map((option) => (
                <label
                  key={option.value}
                  className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-border px-4 py-3 has-[:checked]:border-accent has-[:checked]:bg-accent/10"
                >
                  <input
                    type="radio"
                    name={`app-audience-${sermon.id}`}
                    value={option.value}
                    checked={audience === option.value}
                    onChange={() => setAudience(option.value)}
                    className="mt-1 size-5 shrink-0"
                  />
                  <span>
                    <span className="block text-[15px] font-semibold">
                      {sermonAudienceLabel(option.value)}
                    </span>
                    <span className="block text-sm text-muted-foreground">{option.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="flex flex-col gap-2">
              <Label htmlFor={`summary-${sermon.id}`}>
                One line about the sermon (optional)
              </Label>
              <Textarea
                id={`summary-${sermon.id}`}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="What this sermon is about, in a sentence."
                rows={2}
              />
            </div>

            <AdvancedSection title="More options">
              <div className="flex flex-col gap-2">
                <Label htmlFor={`preached-${sermon.id}`}>Preached on</Label>
                <Input
                  id={`preached-${sermon.id}`}
                  type="date"
                  value={preachedOn}
                  onChange={(e) => setPreachedOn(e.target.value)}
                  className="w-fit tabular-nums"
                />
                <p className="text-sm text-muted-foreground">
                  Usually the sermon date. Change it only if you preached it on
                  a different day.
                </p>
              </div>
            </AdvancedSection>

            {!notesReadiness.ready && slidesReadiness.ready && (
              <p className="text-sm text-muted-foreground">
                Only the slides will be published. The notes follow once the
                sermon has a lesson, or a title and a passage.
              </p>
            )}
            {notesReadiness.ready && !slidesReadiness.ready && (
              <p className="text-sm text-muted-foreground">
                Only the notes will be published. The slides follow once the
                sermon has a title and a passage.
              </p>
            )}

            {error && (
              <p role="alert" className="text-[15px] text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Go back
            </Button>
            <Button type="button" disabled={pending} onClick={publish}>
              {pending ? (
                <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
              ) : (
                <Smartphone aria-hidden className="size-5" />
              )}
              {pending ? "Publishing…" : inApp ? "Update in the app" : "Publish to the app"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Takes the sermon's notes and slides out of the app, after a confirmation.
 * The page then reads "Draft" again (status is derived from what members can
 * see, not the builder's own column).
 */
export function RemoveFromAppButton({
  sermon,
  presentation = null,
}: {
  sermon: Sermon;
  presentation?: ActivePresentationVersion | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { notesShared, slidesShared, inApp } = appShareState(sermon, presentation);
  if (!inApp) return null;

  const remove = async () => {
    const ok = await confirmAction({
      title: `Remove "${sermon.title}" from the app?`,
      description:
        "People won't see its notes or slides in the app any more. It goes back to Draft here, and you can publish it again at any time.",
      confirmLabel: "Remove from the app",
      destructive: true,
    });
    if (!ok) return;

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
      router.refresh();
      if (errors.length > 0) {
        toast.error(errors[0]);
        return;
      }
      toast.success(`"${sermon.title}" was removed from the app.`);
    });
  };

  return (
    <Button type="button" variant="ghost" disabled={pending} onClick={remove}>
      {pending ? (
        <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
      ) : (
        <X aria-hidden className="size-5" />
      )}
      Remove from the app
    </Button>
  );
}
