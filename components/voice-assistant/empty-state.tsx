"use client";

import { Sparkles } from "lucide-react";

export function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-accent/40 bg-accent/5 px-5 py-6 text-center">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-accent/15 text-accent">
        <Sparkles className="size-5" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold">
        Set up your AI phone assistant in 2 minutes
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Give your assistant a name below, choose how they sound, and save. Your
        callers will get a warm, helpful greeting every time.
      </p>
    </div>
  );
}
