"use client";

import { useState, useTransition } from "react";
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
import type { Sermon } from "@/types/sermon";

type Audience = "public" | "followers" | "members";

const AUDIENCES: Array<{ value: Audience; label: string; hint: string }> = [
  { value: "public", label: "Anyone", hint: "Visible to anyone who finds your church in the app." },
  { value: "followers", label: "Followers", hint: "People who follow your church." },
  { value: "members", label: "Members", hint: "People who have joined your church." },
];

/**
 * Sharing a sermon's notes in the member app.
 *
 * Deliberately explicit about what travels: a preacher writing style notes for
 * themselves should never have to wonder whether the congregation can read
 * them. Only the outline and the discussion questions are sent — the manuscript
 * never is — and the card says so on screen rather than in a doc nobody opens.
 */
export function ShareInAppCard({ sermon }: { sermon: Sermon }) {
  const shared =
    (sermon.mobile_visibility ?? "none") !== "none" &&
    Boolean(sermon.mobile_published_at) &&
    !sermon.mobile_unpublished_at;

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [audience, setAudience] = useState<Audience>(
    shared && sermon.mobile_visibility && sermon.mobile_visibility !== "none"
      ? sermon.mobile_visibility
      : "members",
  );
  const [summary, setSummary] = useState(sermon.mobile_summary ?? "");
  const [preachedOn, setPreachedOn] = useState(sermon.mobile_preached_on ?? "");

  const isDraft = sermon.status !== "published";

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
      setSuccess(shared ? "Updated in the app." : "Shared in the app.");
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
      setSuccess("Removed from the app.");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="size-4 text-accent" strokeWidth={1.75} />
          Share in the member app
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Members see the outline, the scripture and the discussion questions.
          Your manuscript and your own notes are never shared.
        </p>

        {isDraft ? (
          <p className="text-sm text-muted-foreground">
            Finish this sermon first — a draft can&apos;t be shared.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label>Who can read it</Label>
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
                      <span className="font-medium">{option.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {option.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor={`preached-${sermon.id}`}>
                Preached on (optional)
              </Label>
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
              <Button type="button" onClick={share} disabled={pending}>
                {pending ? "Saving…" : shared ? "Update" : "Share in app"}
              </Button>
              {shared && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={unshare}
                  disabled={pending}
                >
                  Remove from app
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
