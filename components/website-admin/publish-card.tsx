"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { setPublished } from "@/app/dashboard/website/actions";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";

/**
 * Whether the website is public, and the one action that changes it.
 *
 * Publishing is a button, not a switch: taking a live site offline is a
 * wide-reach change and asks first; putting it online says what just happened.
 */
export function PublishCard({
  initialPublished,
  previewUrl,
  liveUrl,
  canEdit,
  summary,
}: {
  initialPublished: boolean;
  previewUrl: string;
  liveUrl: string | null;
  canEdit: boolean;
  /** One quiet line of context, e.g. "11 of 13 sections showing · Harvest look". */
  summary?: string;
}) {
  const [published, setPublishedState] = useState(initialPublished);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function apply(next: boolean) {
    startTransition(async () => {
      const result = await setPublished(next);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPublishedState(next);
      toast.success(
        next
          ? "Your website is live. Anyone can visit it now."
          : "Your website is offline. Only you can see it, in the preview.",
      );
      router.refresh();
    });
  }

  async function takeOffline() {
    const ok = await confirmAction({
      title: "Take your website offline?",
      description:
        "Visitors will see a “page not found” message, and search engines will stop showing your site. Your pages and changes are kept, and you can publish again at any time.",
      confirmLabel: "Take website offline",
      destructive: true,
    });
    if (ok) apply(false);
  }

  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-heading text-xl font-bold">
              {published ? "Your website is live" : "Your website isn't published yet"}
            </h2>
            <StatusBadge tone={published ? "done" : "neutral"}>
              {published ? "Live" : "Draft"}
            </StatusBadge>
          </div>
          <p className="text-[15px] text-muted-foreground">
            {published
              ? "Anyone can visit it, and search engines can find it. Changes you make go live as you type."
              : "Only you can see it, using the preview. Publish when you're happy with it."}
          </p>
          {summary ? <p className="text-sm text-muted-foreground">{summary}</p> : null}
        </div>

        {canEdit ? (
          published ? (
            <Button variant="outline" onClick={() => void takeOffline()} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Take website offline
            </Button>
          ) : (
            <Button size="lg" onClick={() => apply(true)} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Publish website
            </Button>
          )
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        {published && liveUrl ? (
          <a href={liveUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline">
              <ExternalLink className="size-4" aria-hidden />
              Visit your website
            </Button>
          </a>
        ) : null}
        <a href={previewUrl} target="_blank" rel="noopener noreferrer">
          <Button variant="outline">
            <Eye className="size-4" aria-hidden />
            Open preview
          </Button>
        </a>
      </div>

      {!canEdit ? (
        <p className="text-sm text-muted-foreground">
          Only church admins can publish the website or take it offline.
        </p>
      ) : null}
    </section>
  );
}
