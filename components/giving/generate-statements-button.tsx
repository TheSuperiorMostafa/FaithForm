"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

export function GenerateStatementsButton({
  year,
  hasEin,
}: {
  year: number;
  hasEin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const generate = () => {
    if (!hasEin) {
      setError("Add your church EIN in Settings first.");
      return;
    }
    startTransition(async () => {
      setError(null);
      const res = await fetch(
        `/api/dashboard/giving/statements/generate?year=${year}`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Generation failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `giving-statements-${year}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  return (
    <div>
      <Button type="button" disabled={pending || !hasEin} onClick={generate}>
        {pending ? "Generating…" : `Generate all ${year} statements (ZIP)`}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      {!hasEin && (
        <p className="mt-2 text-xs text-muted-foreground">
          EIN required — configure in Settings → Giving.
        </p>
      )}
    </div>
  );
}
