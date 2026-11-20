"use client";

import { useMemo, useState } from "react";
import { Music, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { List, ListRow } from "@/components/ui/list-row";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import type { SongListRow } from "@/lib/service-plans/songs/types";
import { formatPlanDate } from "@/lib/service-plans/timing";

type Usage = "all" | "used" | "unused";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`,.!?]/g, "")
    .toLowerCase()
    .trim();
}

/** The song list with search and filters, all in the browser. */
export function SongLibrary({ songs }: { songs: SongListRow[] }) {
  const [query, setQuery] = useState("");
  const [key, setKey] = useState("");
  const [tag, setTag] = useState("");
  const [usage, setUsage] = useState<Usage>("all");

  const keys = useMemo(
    () => [...new Set(songs.map((s) => s.defaultKey).filter(Boolean) as string[])].sort(),
    [songs],
  );
  const tags = useMemo(
    () => [...new Set(songs.flatMap((s) => s.tags))].sort((a, b) => a.localeCompare(b)),
    [songs],
  );

  const shown = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return songs.filter((s) => {
      if (key && s.defaultKey !== key) return false;
      if (tag && !s.tags.includes(tag)) return false;
      if (usage === "used" && s.timesUsed12Months === 0) return false;
      if (usage === "unused" && s.timesUsed12Months > 0) return false;
      if (!words.length) return true;
      const haystack = normalize(`${s.title} ${s.author ?? ""} ${s.ccliNumber ?? ""} ${s.tags.join(" ")}`);
      return words.every((w) => haystack.includes(w));
    });
  }, [songs, query, key, tag, usage]);

  const filtered = Boolean(query || key || tag || usage !== "all");
  const clear = () => {
    setQuery("");
    setKey("");
    setTag("");
    setUsage("all");
  };

  return (
    <section aria-label="Songs" className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <div className="space-y-2 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="song-search">Search</Label>
          <Input
            id="song-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Title, writer or CCLI number"
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="song-key">Key</Label>
          <Select id="song-key" value={key} onChange={(e) => setKey(e.target.value)}>
            <option value="">Any key</option>
            {keys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="song-tag">Tag</Label>
          <Select id="song-tag" value={tag} onChange={(e) => setTag(e.target.value)} disabled={!tags.length}>
            <option value="">{tags.length ? "Any tag" : "No tags yet"}</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="song-usage">Sung in the last 12 months</Label>
          <Select id="song-usage" value={usage} onChange={(e) => setUsage(e.target.value as Usage)}>
            <option value="all">All songs</option>
            <option value="used">Sung</option>
            <option value="unused">Not sung</option>
          </Select>
        </div>
      </div>

      <p className="text-[15px] text-muted-foreground" aria-live="polite">
        {filtered
          ? `Showing ${shown.length} of ${songs.length} ${songs.length === 1 ? "song" : "songs"}`
          : `${songs.length} ${songs.length === 1 ? "song" : "songs"}`}
      </p>

      {shown.length === 0 ? (
        <EmptyState
          compact
          icon={SearchX}
          title="No songs match"
          description="Try a different search, or clear the filters to see every song."
          action={
            <Button variant="outline" onClick={clear}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <List label="Songs">
          {shown.map((song) => (
            <ListRow
              key={song.id}
              href={`/dashboard/plans/songs/${song.id}`}
              leading={
                <span
                  aria-hidden
                  className="flex size-12 items-center justify-center rounded-2xl bg-primary/[0.07] font-heading text-base font-bold text-primary dark:bg-accent/15 dark:text-accent"
                >
                  {song.defaultKey ?? <Music className="size-5" strokeWidth={1.75} />}
                </span>
              }
              title={song.title}
              subtitle={[
                song.author,
                song.defaultKey ? `Key of ${song.defaultKey}` : null,
                song.lastUsed ? `Last sung ${formatPlanDate(song.lastUsed, "short")}` : "Not sung yet",
              ]
                .filter(Boolean)
                .join(" · ")}
              status={<UsageBadge song={song} />}
            />
          ))}
        </List>
      )}
    </section>
  );
}

function UsageBadge({ song }: { song: SongListRow }) {
  const className = "hidden sm:inline-flex";
  if (song.timesUsed12Months > 0) {
    return (
      <StatusBadge tone="done" className={className}>
        Sung {song.timesUsed12Months} {song.timesUsed12Months === 1 ? "time" : "times"}
      </StatusBadge>
    );
  }
  if (song.nextScheduled) {
    return (
      <StatusBadge tone="working" className={className}>
        Planned {formatPlanDate(song.nextScheduled, "short").replace(/^\w+, /, "")}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="neutral" className={className}>
      Not sung in 12 months
    </StatusBadge>
  );
}
