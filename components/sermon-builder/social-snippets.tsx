"use client";

import { useState } from "react";
import { Copy, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import type { SocialSnippets } from "@/types/sermon";

const CHANNELS = [
  { key: "instagram" as const, label: "Instagram", limit: 2200 },
  { key: "facebook" as const, label: "Facebook", limit: 5000 },
  { key: "twitter" as const, label: "X (Twitter)", limit: 280 },
  { key: "email" as const, label: "Email", limit: 2000 },
];

const WRITE_FAILED =
  "We couldn't write the posts just now. Nothing was changed. Please try again in a minute.";

/**
 * Ready-to-post text about the sermon for each channel. Nothing is posted
 * from here: people copy what they want and paste it where they post.
 */
export function SocialSnippetsPanel({
  sermonId,
  initial,
}: {
  sermonId: string;
  initial?: SocialSnippets;
}) {
  const [snippets, setSnippets] = useState<SocialSnippets>(initial ?? {});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAny = CHANNELS.some(({ key }) => Boolean(snippets[key]?.trim()));

  async function generate() {
    if (hasAny) {
      const ok = await confirmAction({
        title: "Write new posts?",
        description: "This replaces the posts below with new ones. Copy anything you want to keep first.",
        confirmLabel: "Write new posts",
      });
      if (!ok) return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sermon/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sermonId,
          channels: CHANNELS.map((c) => c.key),
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        snippets?: SocialSnippets;
        error?: unknown;
      } | null;
      if (!res.ok || !data?.snippets) {
        setError(typeof data?.error === "string" ? data.error : WRITE_FAILED);
        return;
      }
      setSnippets(data.snippets);
      toast.success("Your social posts are ready to copy.");
    } catch {
      setError(WRITE_FAILED);
    } finally {
      setLoading(false);
    }
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} post copied. Paste it where you post.`);
    } catch {
      toast.error("We couldn't copy that. Select the text and copy it yourself.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={generate} disabled={loading} variant={hasAny ? "outline" : "default"}>
          {loading ? (
            <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Sparkles aria-hidden className="size-5" />
          )}
          {loading ? "Writing posts…" : hasAny ? "Write new posts" : "Write social posts"}
        </Button>
        <p className="text-[15px] text-muted-foreground">
          Nothing is posted for you. Copy a post and paste it where you share.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-[15px] text-destructive">
          {error}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {CHANNELS.map(({ key, label, limit }) => {
          const text = snippets[key] ?? "";
          const tooLong = text.length > limit;
          return (
            <Card key={key}>
              <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
                <CardTitle>{label}</CardTitle>
                {text && (
                  <span
                    className={
                      tooLong ? "text-sm font-medium text-destructive" : "text-sm text-muted-foreground"
                    }
                  >
                    {tooLong
                      ? `${text.length - limit} characters too long`
                      : `${text.length} of ${limit} characters`}
                  </span>
                )}
              </CardHeader>
              <CardContent className="flex flex-col items-start gap-3">
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
                  {text || <span className="text-muted-foreground">Not written yet.</span>}
                </p>
                {text && (
                  <Button variant="outline" onClick={() => void copy(label, text)}>
                    <Copy aria-hidden className="size-5" />
                    Copy {label} post
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
