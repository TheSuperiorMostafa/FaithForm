import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { MediaTileCard } from "@/components/media/media-tile";
import {
  itemTile,
  seriesTile,
  type BrowseItemInput,
  type BrowseLinks,
  type BrowseSeriesInput,
  type ShelfShape,
} from "@/lib/media/shelves";

/**
 * A wrapping grid of tiles, for the pages a shelf's "view all" opens onto.
 *
 * Deliberately not a rail. A rail implies a curated, bounded set worth
 * scrolling through in order; these pages are unbounded and have no order
 * anyone cares about beyond newest-first, and a horizontal scrollbar holding
 * four hundred items is unusable.
 */
export function MediaGrid({
  items,
  series,
  links,
  shape = "wide",
  emptyMessage,
}: {
  items?: BrowseItemInput[];
  series?: BrowseSeriesInput[];
  links: BrowseLinks;
  shape?: Exclude<ShelfShape, "row">;
  emptyMessage: string;
}) {
  const tiles = [
    ...(series ?? []).map((entry) => seriesTile(entry, links)),
    ...(items ?? []).map((item) => itemTile(item, links, { shape })),
  ];

  if (tiles.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div
      className={
        shape === "poster"
          ? "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
          : "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      }
    >
      {tiles.map((tile) => (
        <MediaTileCard key={`${tile.kind}:${tile.id}`} tile={tile} shape={shape} fluid />
      ))}
    </div>
  );
}

/** Heading with a way back. Every media sub-page is reached from the library. */
export function MediaPageHeader({
  title,
  description,
  backHref,
  backLabel,
  children,
}: {
  title: string;
  description?: string | null;
  backHref: string;
  backLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-accent"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {backLabel}
      </Link>

      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-lg font-bold">{title}</h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>

      {children}
    </div>
  );
}
