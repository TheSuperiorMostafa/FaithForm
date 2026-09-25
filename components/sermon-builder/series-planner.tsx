"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PLAN_FAILED =
  "We couldn't plan the series just now. Nothing was saved. Please try again in a minute.";

export function SeriesPlanner() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [theme, setTheme] = useState("");
  const [weeksPlanned, setWeeksPlanned] = useState(4);
  const [scriptureAnchor, setScriptureAnchor] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sermon/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          theme,
          weeks_planned: weeksPlanned,
          scripture_anchor: scriptureAnchor,
          description: description || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        series?: { id?: string };
        error?: unknown;
      } | null;
      if (!res.ok || !data?.series?.id) {
        setError(typeof data?.error === "string" ? data.error : PLAN_FAILED);
        setLoading(false);
        return;
      }
      toast.success(`"${title.trim()}" is planned.`);
      router.push(`/dashboard/sermon-builder/series/${data.series.id}`);
    } catch {
      setError(PLAN_FAILED);
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-3xl">
      <CardHeader>
        <CardTitle>Plan a sermon series</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="title">Series title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="The Fruit of the Spirit"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="theme">What the series is about</Label>
            <Input
              id="theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              required
              placeholder="Living by the Spirit day to day"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="anchor">Main Bible passage (optional)</Label>
            <Input
              id="anchor"
              value={scriptureAnchor}
              onChange={(e) => setScriptureAnchor(e.target.value)}
              placeholder="Galatians 5:22-23"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="weeks">How many weeks</Label>
            <Input
              id="weeks"
              type="number"
              min={2}
              max={12}
              value={weeksPlanned}
              onChange={(e) => setWeeksPlanned(Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">Description (optional)</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          {error && (
            <p role="alert" className="text-[15px] text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-fit" disabled={loading}>
            {loading ? (
              <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
            ) : (
              <Sparkles aria-hidden className="size-5" />
            )}
            {loading ? "Planning your series…" : "Plan the series"}
          </Button>
          {loading && (
            <p className="text-sm text-muted-foreground" role="status">
              This usually takes 15 to 30 seconds.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
