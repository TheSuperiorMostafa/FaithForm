"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      router.push(`/dashboard/sermon-builder/series/${data.series.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full">
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
            <Label htmlFor="theme">Theme</Label>
            <Input
              id="theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="anchor">Anchor scripture</Label>
            <Input
              id="anchor"
              value={scriptureAnchor}
              onChange={(e) => setScriptureAnchor(e.target.value)}
              placeholder="Galatians 5:22-23"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="weeks">Weeks</Label>
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
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={loading}>
            {loading ? "Planning series…" : "Generate series plan"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
