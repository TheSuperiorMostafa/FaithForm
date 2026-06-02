"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModelBadge } from "@/components/sermon-builder/model-badge";
import type { SocialSnippets } from "@/types/sermon";

const CHANNELS = [
  { key: "instagram" as const, label: "Instagram", limit: 2200 },
  { key: "facebook" as const, label: "Facebook", limit: 5000 },
  { key: "twitter" as const, label: "X / Twitter", limit: 280 },
  { key: "email" as const, label: "Email blurb", limit: 2000 },
];

export function SocialSnippetsPanel({
  sermonId,
  initial,
}: {
  sermonId: string;
  initial?: SocialSnippets;
}) {
  const [snippets, setSnippets] = useState<SocialSnippets>(initial ?? {});
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setSnippets(data.snippets);
      setModelUsed(data.modelUsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={generate} disabled={loading}>
          {loading ? "Generating…" : "Generate snippets"}
        </Button>
        <ModelBadge model={modelUsed} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {CHANNELS.map(({ key, label, limit }) => {
          const text = snippets[key] ?? "";
          return (
            <Card key={key}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle>{label}</CardTitle>
                <span
                  className={
                    text.length > limit
                      ? "text-xs text-destructive"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {text.length}/{limit}
                </span>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{text || "—"}</p>
                {text && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => void navigator.clipboard.writeText(text)}
                  >
                    Copy
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
