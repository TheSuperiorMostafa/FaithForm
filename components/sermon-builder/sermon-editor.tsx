"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { FileDown, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/sermon-builder/section-card";
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

const SAVE_FAILED =
  "We couldn't save your last change. Check your internet connection; your text is still here.";
const DRAFT_FAILED =
  "We couldn't write the draft just now. Nothing was changed. Please try again in a minute.";

/**
 * The full-manuscript editor for sermons made with the older outline-and-draft
 * builder. Publishing, slides, social posts and deleting live on the sermon
 * page around it; this is only the writing. (Its old "Mark published" button
 * is gone: "Publish to the app" is the one way to publish.)
 */
export function SermonEditor({ sermon: initial }: Props) {
  const [sermon, setSermon] = useState(initial);
  const [outline] = useState(initial.outline as SermonOutline | null);
  const [content, setContent] = useState<SermonContent>(
    (initial.content as SermonContent | null) ?? emptyContent,
  );
  const [draftLoading, setDraftLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      try {
        const res = await fetch(`/api/sermon/${sermon.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          setError(SAVE_FAILED);
          return;
        }
        const data = await res.json();
        setSermon(data.sermon);
        setError(null);
      } catch {
        setError(SAVE_FAILED);
      }
    },
    [sermon.id],
  );

  const saveContent = useCallback(() => {
    void save({ content, title: sermon.title });
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
          setError(
            "Writing the draft took too long. Please try again; long sermons can take up to a minute.",
          );
          return;
        }
        const data = contentType.includes("application/json")
          ? ((await res.json().catch(() => null)) as { error?: unknown } | null)
          : null;
        setError(typeof data?.error === "string" ? data.error : DRAFT_FAILED);
        return;
      }
      const data = await res.json();
      setContent(data.content);
      setSermon(data.sermon);
    } catch {
      setError(DRAFT_FAILED);
    } finally {
      setDraftLoading(false);
    }
  }

  async function regenerateDraft() {
    const ok = await confirmAction({
      title: "Write a new draft?",
      description:
        "This replaces the whole manuscript below, including anything you typed yourself. It can't be undone.",
      confirmLabel: "Replace the draft",
      destructive: true,
    });
    if (ok) await generateDraft();
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex-1 space-y-2">
          <Label htmlFor={`title-${sermon.id}`}>Sermon title</Label>
          <Input
            id={`title-${sermon.id}`}
            value={sermon.title}
            onChange={(e) => setSermon({ ...sermon, title: e.target.value })}
            onBlur={() => void save({ title: sermon.title })}
            className="font-heading text-xl font-semibold"
          />
          <p className="text-[15px] text-muted-foreground">
            {sermon.scripture_refs.join(" · ")} · {sermon.duration_min} minutes.
            Changes save when you click away from a box.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <a href={`/api/sermon/${sermon.id}/export/pdf`} download>
                <FileDown aria-hidden className="size-5" strokeWidth={1.75} />
                Download lesson (PDF)
              </a>
            }
          />
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link href={`/dashboard/sermon-builder/${sermon.id}/discussion`}>
                <MessageCircle aria-hidden className="size-5" strokeWidth={1.75} />
                Discussion questions
              </Link>
            }
          />
        </div>
      </div>

      {outline && (
        <Card>
          <CardHeader>
            <CardTitle>Outline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-[15px]">
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
            <p className="text-[15px] text-muted-foreground">
              Your outline is ready. Write a full draft of the sermon next.
            </p>
            <Button onClick={generateDraft} disabled={draftLoading}>
              Write the full draft
            </Button>
          </CardContent>
        </Card>
      )}

      {draftLoading && (
        <p className="text-center text-[15px] text-muted-foreground" role="status">
          Writing your sermon draft. This can take a minute.
        </p>
      )}

      {error && (
        <p role="alert" className="text-[15px] text-destructive">
          {error}
        </p>
      )}

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
            <Button variant="outline" onClick={regenerateDraft} disabled={draftLoading}>
              Write a new draft
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
