"use client";

import { CheckCircle2, Circle } from "lucide-react";
import type { SetupChecklistItem } from "@/lib/utils/voice-assistant-validation";

type SetupChecklistProps = {
  items: SetupChecklistItem[];
  isFirstSetup: boolean;
};

export function SetupChecklist({ items, isFirstSetup }: SetupChecklistProps) {
  const doneCount = items.filter((item) => item.done).length;
  const complete = doneCount === items.length;

  return (
    <div className="rounded-xl border border-border bg-card px-5 py-5 shadow-card dark:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">
            {isFirstSetup
              ? "Finish setup to go live"
              : complete
                ? "Setup complete"
                : "Finish required setup"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {complete
              ? "Required fields are filled. Assign a phone number in Retell when you’re ready for callers."
              : "Voice agents need identity, a transfer line, greeting, and hours before they should answer calls."}
          </p>
        </div>
        <p className="text-sm tabular-nums text-muted-foreground">
          {doneCount}/{items.length}
        </p>
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-sm">
            {item.done ? (
              <CheckCircle2
                className="size-4 shrink-0 text-green-600 dark:text-green-400"
                aria-hidden
              />
            ) : (
              <Circle
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            )}
            <span
              className={
                item.done ? "text-muted-foreground line-through" : "font-medium"
              }
            >
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
