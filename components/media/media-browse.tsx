"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import { MediaShelfRail } from "@/components/media/media-shelf";
import { MediaTileCard } from "@/components/media/media-tile";
import { Input } from "@/components/ui/input";
import { readProgress } from "@/lib/media/local-progress";
import {
  itemTile,
  withContinueShelf,
  type BrowseItemInput,
  type BrowseLinks,
  type MediaBrowse,
  type MediaFeatured,
} from "@/lib/media/shelves";
import { cn } from "@/lib/utils";

/**
 * The browse screen.
 *
 * Server-rendered shelves arrive as a prop; the only thing decided here is the
 * "Continue watching" row, which is built from `localStorage` because the
 * server holds no record of what anyone watched. That is why this component is
 * a client component at all.
 *
 * Search deliberately replaces the shelves rather than filtering them. A rail
 * that empties as you type reads as broken, and "Topics" filtered by a search
 * term is meaningless. Typing switches the page into a flat result grid and
 * clearing switches it back.
 */
export function MediaBrowseView({
  browse,
  items,
  links,
  churchId,
  searchPlaceholder = "Search by title, series, speaker, passage, or topic…",
}: {
  browse: MediaBrowse;
  /** The full set, for search. Shelves only ever carry a slice of it. */
  items: BrowseItemInput[];
  links: BrowseLinks;
  churchId: string;
  searchPlaceholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [progress, setProgress] = useState<ReturnType<typeof readProgress>>([]);

  // Read after mount, never during render. localStorage is not available on the
  // server, so reading it in the initial render would make the markup differ
  // between server and client and React would discard the tree.
  useEffect(() => {
    setProgress(readProgress(churchId));
  }, [churchId]);

  const withContinue = useMemo(
    () =>
      withContinueShelf(
        browse,
        progress.map((entry) => ({
          itemId: entry.itemId,
          positionSec: entry.positionSec,
          durationSec: entry.durationSec,
          updatedAt: entry.updatedAt,
        })),
        links,
        items,
      ),
    [browse, progress, links, items],
  );

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;

    return items.filter((item) => {
      const haystack = [
        item.title ?? "",
        item.seriesName ?? "",
        ...item.speakers,
        ...item.chapters,
        ...item.topics,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [items, query]);

  if (browse.empty) {
    return (
      <p className="rounded-xl border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">
        No recordings yet. They appear here after a live broadcast ends.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          className="pl-9"
          aria-label="Search the media library"
        />
      </div>

      {results ? (
        <SearchResults results={results} links={links} />
      ) : (
        <>
          {withContinue.featured ? (
            <FeaturedItem featured={withContinue.featured} />
          ) : null}

          {withContinue.shelves.map((shelf) => (
            <MediaShelfRail key={shelf.id} shelf={shelf} />
          ))}
        </>
      )}
    </div>
  );
}

function SearchResults({
  results,
  links,
}: {
  results: BrowseItemInput[];
  links: BrowseLinks;
}) {
  if (results.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
        Nothing matches that search.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {results.length === 1 ? "1 result" : `${results.length} results`}
      </p>
      {/* A wrapping grid, not a rail: search results have no meaningful order
          to scroll through and the count is unbounded. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {results.map((item) => (
          <MediaTileCard
            key={item.id}
            tile={itemTile(item, links, { shape: "wide" })}
            shape="wide"
            fluid
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The one item above the shelves.
 *
 * Only ever rendered when there is artwork for it (`assembleBrowse` returns
 * null otherwise) or when something is genuinely live. A large empty rectangle
 * at the top of the page is a worse first impression than starting at the
 * shelves, which handle missing artwork gracefully at tile size.
 */
function FeaturedItem({ featured }: { featured: MediaFeatured }) {
  const isLive = featured.state === "live";

  return (
    <Link
      href={featured.href}
      className={cn(
        "group relative flex min-h-[220px] items-end overflow-hidden rounded-2xl border border-border sm:min-h-[300px]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        "hover:border-accent/60",
      )}
    >
      {featured.artwork ? (
        // eslint-disable-next-line @next/next/no-img-element -- church-supplied storage URL
        <img
          src={featured.artwork.url}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span className="absolute inset-0 bg-muted" />
      )}

      {/* A flat scrim, not a gradient: tokens.json rules gradients out, and a
          solid low-opacity wash over the lower half is what makes overlaid text
          legible without turning the photo into a decoration. */}
      <span aria-hidden className="absolute inset-0 bg-brand-navy/55" />

      <div className="relative flex flex-col gap-2 p-5 sm:p-7">
        {isLive ? (
          // Matches the badge the public player already uses, so the same
          // broadcast does not announce itself two different ways.
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-red-600 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white">
            <span className="size-2 animate-pulse rounded-full bg-white" />
            Live
          </span>
        ) : featured.state === "upcoming" ? (
          <span className="w-fit rounded-md bg-background/90 px-2 py-1 text-xs font-semibold text-foreground">
            Up next
          </span>
        ) : null}

        <h3 className="font-heading text-xl font-bold text-white sm:text-2xl">
          {featured.title}
        </h3>
        {featured.subtitle ? (
          <p className="text-sm text-white/80">{featured.subtitle}</p>
        ) : null}
      </div>
    </Link>
  );
}
