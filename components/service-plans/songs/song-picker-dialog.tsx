"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Music, Plus, Search } from "lucide-react";
import { searchSongsAction } from "@/app/dashboard/plans/songs/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { SongPickerOption } from "@/lib/service-plans/songs/types";
import { formatDuration } from "@/lib/service-plans/timing";

/**
 * Choose a song (and, when it has several, an arrangement) for a plan item.
 * Searches the library as you type; a song with one arrangement is picked
 * with one tap.
 */
export function SongPickerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (song: SongPickerOption, arrangementId: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState<SongPickerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setExpanded(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = ++request.current;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const result = await searchSongsAction(query);
      if (id !== request.current) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        setSongs([]);
        return;
      }
      setError(null);
      setSongs(result.songs);
    }, query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const pick = (song: SongPickerOption, arrangementId: string | null) => {
    onPick(song, arrangementId);
    onOpenChange(false);
  };

  const choose = (song: SongPickerOption) => {
    if (song.arrangements.length > 1) {
      setExpanded((current) => (current === song.id ? null : song.id));
      return;
    }
    pick(song, song.arrangements[0]?.id ?? null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a song</DialogTitle>
          <DialogDescription>Search your song library by title, writer or CCLI number.</DialogDescription>
        </DialogHeader>
        <div className="shrink-0 border-b border-border px-6 py-4">
          <label htmlFor="song-picker-search" className="sr-only">
            Search songs
          </label>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="song-picker-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Amazing Grace"
              autoComplete="off"
              autoFocus
              className="pl-11"
            />
          </div>
        </div>

        <div className="min-h-0 flex-auto overflow-y-auto px-3 py-3" aria-busy={loading}>
          {loading && songs.length === 0 ? (
            <ul aria-hidden className="space-y-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="flex min-h-[64px] items-center gap-3 px-3 py-2">
                  <Skeleton className="size-10 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-48 max-w-full" />
                    <Skeleton className="h-3.5 w-32 max-w-full" />
                  </div>
                </li>
              ))}
            </ul>
          ) : error ? (
            <p role="alert" className="px-3 py-6 text-center text-[15px] text-destructive">
              {error}
            </p>
          ) : songs.length === 0 ? (
            <p className="px-3 py-6 text-center text-[15px] text-muted-foreground">
              {query.trim() ? `No songs match “${query.trim()}”.` : "Your song library is empty."}
            </p>
          ) : (
            <ul aria-label="Songs" className="space-y-1">
              {songs.map((song) => {
                const several = song.arrangements.length > 1;
                const isOpen = expanded === song.id;
                return (
                  <li key={song.id}>
                    <button
                      type="button"
                      onClick={() => choose(song)}
                      aria-expanded={several ? isOpen : undefined}
                      className="flex min-h-[64px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-accent/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span
                        aria-hidden
                        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07] font-heading text-sm font-bold text-primary dark:bg-accent/15 dark:text-accent"
                      >
                        {song.defaultKey ?? <Music className="size-4" strokeWidth={1.75} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-foreground">{song.title}</span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {[
                            song.author,
                            song.ccliNumber ? `CCLI ${song.ccliNumber}` : null,
                            several ? `${song.arrangements.length} arrangements` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "No writer listed"}
                        </span>
                      </span>
                      {several ? (
                        <ChevronRight
                          aria-hidden
                          className={`size-5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                        />
                      ) : (
                        <span className="shrink-0 text-sm font-semibold text-primary dark:text-accent">Add</span>
                      )}
                    </button>
                    {several && isOpen && (
                      <ul aria-label={`Arrangements of ${song.title}`} className="mb-2 ml-[3.25rem] mr-1 space-y-1">
                        {song.arrangements.map((arrangement) => (
                          <li key={arrangement.id}>
                            <button
                              type="button"
                              onClick={() => pick(song, arrangement.id)}
                              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left text-[15px] transition-colors hover:border-accent/60 hover:bg-accent/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span className="min-w-0 truncate font-semibold text-foreground">{arrangement.name}</span>
                              <span className="shrink-0 text-sm text-muted-foreground">
                                {[
                                  arrangement.key ? `Key of ${arrangement.key}` : null,
                                  arrangement.lengthSeconds ? formatDuration(arrangement.lengthSeconds) : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="outline" nativeButton={false} render={<Link href="/dashboard/plans/songs" />}>
            <Plus aria-hidden className="size-5" />
            Add a new song
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
