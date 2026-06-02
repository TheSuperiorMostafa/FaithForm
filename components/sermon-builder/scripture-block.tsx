"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

type PassageData = {
  text: string;
  translation?: string;
  copyright?: string;
};

export function ScriptureBlock({ passage }: { passage: string }) {
  const [data, setData] = useState<PassageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!passage.trim()) return;
    let cancelled = false;
    setData(null);
    setError(null);

    fetch(`/api/scripture/${encodeURIComponent(passage.trim())}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load passage");
        return res.json() as Promise<PassageData>;
      })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error");
      });

    return () => {
      cancelled = true;
    };
  }, [passage]);

  if (!passage.trim()) return null;
  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (!data) return <Skeleton className="h-20 w-full" />;

  return (
    <div className="space-y-1">
      <blockquote className="rounded-lg border border-border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap">
        {data.text}
      </blockquote>
      {data.translation && (
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {data.translation}
        </p>
      )}
    </div>
  );
}
