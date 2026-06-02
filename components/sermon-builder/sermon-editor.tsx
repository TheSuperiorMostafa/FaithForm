"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { MessageCircle, Share2 } from "lucide-react";
import { DeleteDraftButton } from "@/components/sermon-builder/delete-draft-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/sermon-builder/section-card";
import { ExportMenu } from "@/components/sermon-builder/export-menu";
import { ModelBadge } from "@/components/sermon-builder/model-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Sermon, SermonContent, SermonOutline } from "@/types/sermon";

type Props = {
  sermon: Sermon;
};

const emptyContent: SermonContent = {
  intro: "",
  points: [],
  illustrations: [],
  application: "",
  prayer: "",
};

export function SermonEditor({ sermon: initial }: Props) {
  const [sermon, setSermon] = useState(initial);
  const [outline] = useState(initial.outline as SermonOutline | null);
  const [content, setContent] = useState<SermonContent>(
    (initial.content as SermonContent | null) ?? emptyContent,
  );
  const [draftLoading, setDraftLoading] = useState(false);
  const [publishLoading, setPublishLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      const res = await fetch(`/api/sermon/${sermon.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Save failed");
      }
      const data = await res.json();
      setSermon(data.sermon);
    },
    [sermon.id],
  );

  const saveContent = useCallback(() => {
    save({ content, title: sermon.title }).catch(() => {});
  }, [save, content, sermon.title]);

  async function generateDraft() {
    setDraftLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sermon/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sermonId: sermon.id }),
      });
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok) {
        if (res.status === 504) {
          throw new Error(
            "Draft generation timed out. Try again — large sermons can take up to a minute.",
          );
        }
        if (contentType.includes("application/json")) {
          const data = await res.json();
          throw new Error(data.error ?? "Draft failed");
        }
        throw new Error(`Draft failed (${res.status})`);
      }
      const data = await res.json();
      setContent(data.content);
      setSermon(data.sermon);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draft failed");
    } finally {
      setDraftLoading(false);
    }
  }

  async function publish() {
    setPublishLoading(true);
    try {
      await save({ status: "published", content, title: sermon.title });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setPublishLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 space-y-2">
          <Input
            value={sermon.title}
            onChange={(e) => setSermon({ ...sermon, title: e.target.value })}
            onBlur={() => save({ title: sermon.title }).catch(() => {})}
            className="font-heading text-xl font-semibold"
          />
          <p className="text-sm text-muted-foreground">
            {sermon.scripture_refs.join(" · ")} · {sermon.duration_min} min
          </p>
          <ModelBadge model={sermon.model_used} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link href={`/dashboard/sermon-builder/${sermon.id}/discussion`} />
            }
          >
            <MessageCircle className="size-4" strokeWidth={1.75} />
            Discussion
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link href={`/dashboard/sermon-builder/${sermon.id}/social`} />
            }
          >
            <Share2 className="size-4" strokeWidth={1.75} />
            Social
          </Button>
          <ExportMenu sermonId={sermon.id} />
          {sermon.status === "draft" && (
            <DeleteDraftButton
              sermonId={sermon.id}
              sermonTitle={sermon.title}
              variant="outline"
              redirectTo="/dashboard/sermon-builder"
            />
          )}
        </div>
      </div>

      {outline && (
        <Card>
          <CardHeader>
            <CardTitle>Outline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{outline.intro}</p>
            <ol className="list-decimal pl-5">
              {outline.points.map((p, i) => (
                <li key={i}>
                  <strong>{p.title}</strong> — {p.summary}
                </li>
              ))}
            </ol>
            <p className="text-muted-foreground">{outline.application}</p>
          </CardContent>
        </Card>
      )}

      {!content.intro && !draftLoading && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Your outline is ready. Generate a full draft manuscript next.
            </p>
            <Button onClick={generateDraft} disabled={draftLoading}>
              Generate full draft
            </Button>
          </CardContent>
        </Card>
      )}

      {draftLoading && (
        <p className="text-center text-sm text-muted-foreground">
          Writing your sermon draft… this may take a minute.
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {content.intro && (
        <>
          <SectionCard
            title="Introduction"
            value={content.intro}
            onChange={(v) => setContent({ ...content, intro: v })}
            onBlur={saveContent}
          />
          {content.points.map((p, i) => (
            <SectionCard
              key={i}
              title={`Point ${i + 1}: ${p.title}`}
              value={p.body}
              onChange={(v) => {
                const points = [...content.points];
                points[i] = { ...points[i], body: v };
                setContent({ ...content, points });
              }}
              onBlur={saveContent}
              rows={10}
            />
          ))}
          <SectionCard
            title="Illustrations"
            value={content.illustrations.join("\n\n")}
            onChange={(v) =>
              setContent({
                ...content,
                illustrations: v.split("\n\n").filter(Boolean),
              })
            }
            onBlur={saveContent}
          />
          <SectionCard
            title="Application"
            value={content.application}
            onChange={(v) => setContent({ ...content, application: v })}
            onBlur={saveContent}
          />
          <SectionCard
            title="Closing prayer"
            value={content.prayer}
            onChange={(v) => setContent({ ...content, prayer: v })}
            onBlur={saveContent}
          />
          <div className="flex gap-2 pb-8">
            <Button variant="outline" onClick={generateDraft} disabled={draftLoading}>
              Regenerate draft
            </Button>
            <Button onClick={publish} disabled={publishLoading}>
              {publishLoading ? "Publishing…" : "Mark published"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
