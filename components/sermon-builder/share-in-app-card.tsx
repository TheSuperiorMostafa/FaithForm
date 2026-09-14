"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Smartphone } from "lucide-react";

import {
  shareSermonInAppAction,
  unshareSermonInAppAction,
} from "@/app/dashboard/sermon-builder/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  isSermonShared,
  LESSON_ANCHOR,
  ONLY_ADMINS_CAN_SHARE,
  SHARE_IN_APP_ANCHOR,
  sermonAudienceLabel,
  sermonShareReadiness,
} from "@/lib/sermons/v1/share-rules";
import type { Sermon } from "@/types/sermon";

type Audience = "followers" | "members";

/**
 * Two choices, not three. Both apps open a church's sermon notes only for a
 * signed-in account that follows or has joined it, so "public" and "followers"
 * reach the same people there; offering both implied a difference nobody would
 * ever see. A sermon already shared as "public" reads as followers here.
 */
const AUDIENCES: Array<{ value: Audience; hint: string }> = [
  {
    value: "followers",
    hint: "Everyone who follows your church in the FaithForm app, including members.",
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

/**
 * Sharing a sermon's notes in the FaithForm app.
 *
 * Deliberately explicit about what travels: a preacher writing style notes for
 * themselves should never have to wonder whether the congregation can read
 * them. Only the outline, the scripture and the discussion questions are sent —
 * the manuscript never is — and the card says so on screen rather than in a doc
 * nobody opens.
 *
 * Sharing is the publish decision. There is no separate "finish" step to find
 * first; what the card does check is that the app would have something to show.
 */
export function ShareInAppCard({
  sermon,
  canShare,
}: {
  sermon: Sermon;
  /** Church admins only; everyone else sees where the sermon stands. */
  canShare: boolean;
}) {
  const shared = isSermonShared(sermon);
  const readiness = sermonShareReadiness(sermon);
  const isSimple = (sermon.kind ?? "advanced") === "simple";

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [audience, setAudience] = useState<Audience>(
    shared && sermon.mobile_visibility === "members"
      ? "members"
      : shared
        ? "followers"
        : "members",
  );
  const [summary, setSummary] = useState(sermon.mobile_summary ?? "");
  // The day it was preached is almost always the day the sermon was built
  // for, so that is the starting point rather than a blank field.
  const [preachedOn, setPreachedOn] = useState(
    sermon.mobile_preached_on ?? sermon.sermon_date ?? "",
  );

  const share = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await shareSermonInAppAction({
        sermonId: sermon.id,
        visibility: audience,
        summary: summary.trim() || null,
        preachedOn: preachedOn || null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess(
        shared
          ? "Updated in the FaithForm app."
          : "Shared in the FaithForm app. Churchgoers can open it now.",
      );
    });
  };

  const unshare = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await unshareSermonInAppAction(sermon.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess("Removed from the FaithForm app.");
    });
  };

  const sharedSince = formatDay(sermon.mobile_published_at);
  const audienceLabel = sermonAudienceLabel(sermon.mobile_visibility);

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
          Churchgoers see the title, scripture, outline and discussion questions
          in your church&apos;s sermon notes. Your manuscript and your own notes
          are never shared.
        </p>

        <p className="text-sm" role="status">
          {shared ? (
            <>
              <span className="font-medium">In the app</span>
              {audienceLabel && <> · {audienceLabel}</>}
              {sharedSince && (
                <span className="text-muted-foreground"> · since {sharedSince}</span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">Not in the app yet.</span>
          )}
        </p>

        {!canShare ? (
          <p className="text-sm text-muted-foreground">{ONLY_ADMINS_CAN_SHARE}</p>
        ) : !readiness.ready && !shared ? (
          <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border p-4">
            <p className="font-medium">{readiness.title}</p>
            <p className="text-sm text-muted-foreground">{readiness.message}</p>
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
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium leading-none">
                Who can read it
              </legend>
              <div className="flex flex-col gap-1">
                {AUDIENCES.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-start gap-2 text-sm"
                  >
                    <input
                      type="radio"
                      name={`audience-${sermon.id}`}
                      value={option.value}
                      checked={audience === option.value}
                      onChange={() => setAudience(option.value)}
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

            <div className="flex flex-col gap-2">
              <Label htmlFor={`preached-${sermon.id}`}>Preached on</Label>
              <Input
                id={`preached-${sermon.id}`}
                type="date"
                value={preachedOn}
                onChange={(e) => setPreachedOn(e.target.value)}
                className="w-fit tabular-nums"
              />
              <p className="text-xs text-muted-foreground">
                The app lists sermon notes by this date, newest first.
              </p>
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

            <p className="text-xs text-muted-foreground">
              {shared
                ? "Edits to this sermon's title, scripture, outline or questions show in the app right away. Press Update after changing who can read it, the date or the line for the list."
                : "Once it's shared, edits you make to this sermon show in the app right away."}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              {(readiness.ready || !shared) && (
                <Button type="button" onClick={share} disabled={pending}>
                  {pending ? "Saving…" : shared ? "Update" : "Share in the FaithForm app"}
                </Button>
              )}
              {shared && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={unshare}
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
          <p className="text-sm font-medium text-green-700 dark:text-green-300" role="status">
            {success}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
