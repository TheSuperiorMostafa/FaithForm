"use client";

import { Button } from "@/components/ui/button";

export function DraftRecoveryNotice({ available, warning, onRestore, onDiscard, autosaves = true }: {
  available: boolean;
  autosaves?: boolean;
  warning?: string | null;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  if (!available && !warning) return null;
  return (
    <aside className="space-y-3 rounded-xl border border-border bg-muted/40 p-4" aria-label="Unsaved website changes">
      {available ? <>
        <p className="text-sm text-foreground">A change from your last visit did not finish saving. Restore it to keep editing, or keep the current version. {autosaves ? "Restored changes save to your website." : "Choose Add sermon after restoring to save the new sermon."}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onRestore}>Restore unsaved changes</Button>
          <Button type="button" variant="ghost" onClick={onDiscard}>Keep current version</Button>
        </div>
      </> : null}
      {warning ? <p role="alert" className="text-sm text-destructive">{warning}</p> : null}
    </aside>
  );
}
