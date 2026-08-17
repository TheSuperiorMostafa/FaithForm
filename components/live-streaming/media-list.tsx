"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { EyeOff, Film, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { MediaItem } from "@/lib/stream/media-library";
import { cn } from "@/lib/utils";

/**
 * Date only — the time of day a service was recorded is noise in a library
 * someone is browsing months later.
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function allTags(item: MediaItem): string[] {
  return [...item.tags.speakers, ...item.tags.chapters, ...item.tags.topics];
}

export function MediaList({ items }: { items: MediaItem[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => {
      const haystack = [
        item.title ?? "",
        item.seriesName ?? "",
        ...allTags(item),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [items, query]);

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No recordings yet. They appear here after a live broadcast ends.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title, series, speaker, passage, or topic…"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
          Nothing matches that search.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((item) => {
            const tags = allTags(item);
            return (
              <li key={item.id}>
                <Link
                  href={`/dashboard/live-streaming/media/${item.id}`}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-4",
                    "shadow-card transition-colors hover:border-accent/60 hover:bg-accent/5 dark:shadow-none",
                  )}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Film className="size-4" strokeWidth={1.75} aria-hidden />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-foreground">
                        {item.title ?? "Service recording"}
                      </p>
                      {item.visibility === "unlisted" && (
                        <Badge variant="secondary" className="gap-1">
                          <EyeOff className="size-3" />
                          Unlisted
                        </Badge>
                      )}
                    </div>

                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {formatDate(item.createdAt)}
                      {item.seriesName ? ` · ${item.seriesName}` : ""}
                    </p>

                    {tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {tags.map((tag) => (
                          <Badge key={tag} variant="outline">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
