"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { createArtworkForMe, type ArtworkTarget } from "@/app/dashboard/live-streaming/media/actions";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";

/** "Create one for me": makes a picture from the title and uses it for every artwork size. */
export function CreateArtworkButton({
  target,
  title,
  hasArtwork,
  onCreated,
  disabled,
}: {
  target: ArtworkTarget;
  title: string;
  hasArtwork: boolean;
  onCreated: () => void;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function create() {
    if (hasArtwork) {
      const ok = await confirmAction({
        title: "Replace the artwork with a new picture?",
        description: "FaithForm makes one picture from the title and uses it for the tile, the wide still and the banner.",
        confirmLabel: "Create artwork",
        cancelLabel: "Keep what's there",
      });
      if (!ok) return;
    }
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await createArtworkForMe({ target, title });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setNotice("New artwork made for every size.");
        onCreated();
      } catch {
        setError("We couldn't confirm the artwork was made. Refresh to check it, then try again if needed.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" disabled={disabled || pending} onClick={() => void create()} className="self-start">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
        {pending ? "Making your artwork…" : "Create one for me"}
      </Button>
      {pending ? <p role="status" className="text-sm text-muted-foreground">This can take up to a minute.</p> : null}
      {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
