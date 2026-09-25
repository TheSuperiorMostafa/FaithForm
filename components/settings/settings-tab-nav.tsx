"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  SETTINGS_TABS,
  settingsTabHref,
  type ResolvedSettingsTab,
  type SettingsTabId,
} from "@/components/settings/settings-tabs-config";
import { cn } from "@/lib/utils";

/**
 * The Settings sections as real links (`?tab=`), so every section can be
 * bookmarked and linked to. The tapped section lights up straight away, before
 * the server has answered, so a slow connection never feels like a dead tap.
 */
export function SettingsTabNav({
  tabs,
  active,
}: {
  tabs: readonly SettingsTabId[];
  active: ResolvedSettingsTab;
}) {
  const [pending, setPending] = useState<SettingsTabId | null>(null);

  // Once the server has rendered the new section, the real state takes over.
  useEffect(() => {
    setPending(null);
  }, [active]);

  const current = pending ?? active;

  return (
    <nav
      aria-label="Settings sections"
      className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-2xl border border-border bg-card p-1.5 shadow-sm"
    >
      {SETTINGS_TABS.filter((tab) => tabs.includes(tab.id)).map((tab) => {
        const isActive = current === tab.id;
        return (
          <Link
            key={tab.id}
            href={settingsTabHref(tab.id)}
            scroll={false}
            aria-current={isActive ? "page" : undefined}
            onClick={() => {
              if (tab.id !== active) setPending(tab.id);
            }}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-5 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-foreground/75 hover:bg-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
