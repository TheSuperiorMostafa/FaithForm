"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { MediaTagChip, MediaTileCard, type TileStatus } from "@/components/media/media-tile";
import type { MediaShelf as Shelf } from "@/lib/media/shelves";
import { cn } from "@/lib/utils";

/**
 * One horizontal rail.
 *
 * Scrolls natively rather than translating a track. Native overflow is what
 * gives trackpad and touch momentum, keyboard `Tab` that brings the next tile
 * into view on its own, and a scrollbar on the platforms that expect one — all
 * of which a transform-based carousel has to reimplement and usually gets
 * wrong for someone. The arrows just call `scrollBy`.
 */
export function MediaShelfRail({
  shelf,
  statuses,
}: {
  shelf: Shelf;
  statuses?: Record<string, TileStatus>;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  // The pair is hidden entirely when nothing overflows. At either end the
  // unavailable direction stays visible but disabled, which keeps the header
  // from shifting while someone scrolls.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const measure = () => {
      const max = track.scrollWidth - track.clientWidth;
      setAtStart(track.scrollLeft <= 1);
      setAtEnd(max <= 1 || track.scrollLeft >= max - 1);
    };

    measure();
    track.addEventListener("scroll", measure, { passive: true });

    const observer = new ResizeObserver(measure);
    observer.observe(track);

    return () => {
      track.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [shelf.tiles.length]);

  function nudge(direction: -1 | 1) {
    const track = trackRef.current;
    if (!track) return;
    // Most of a viewport rather than all of it, so a tile stays on screen as
    // an anchor and nobody loses their place.
    track.scrollBy({ left: direction * track.clientWidth * 0.8, behavior: "smooth" });
  }

  const overflows = !(atStart && atEnd);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h3 className="font-heading text-lg font-bold text-foreground">{shelf.title}</h3>
          {shelf.viewAll ? (
            <Link
              href={shelf.viewAll.href}
              className="inline-flex min-h-11 shrink-0 items-center text-[15px] font-medium text-muted-foreground underline underline-offset-4 hover:text-accent"
            >
              {shelf.viewAll.label}
            </Link>
          ) : null}
        </div>

        {overflows ? (
          <div className="hidden shrink-0 gap-1 sm:flex">
            <button
              type="button"
              aria-label={`Scroll ${shelf.title} left`}
              disabled={atStart}
              onClick={() => nudge(-1)}
              className={cn(
                "flex size-11 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors",
                "hover:border-accent/60 hover:text-foreground disabled:opacity-30 disabled:hover:border-border",
              )}
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Scroll ${shelf.title} right`}
              disabled={atEnd}
              onClick={() => nudge(1)}
              className={cn(
                "flex size-11 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors",
                "hover:border-accent/60 hover:text-foreground disabled:opacity-30 disabled:hover:border-border",
              )}
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>

      <div
        ref={trackRef}
        // `-mx-1 px-1` so a focus ring on the first tile is not clipped by the
        // scroll container. `scroll-smooth` is left off: it fights the
        // `behavior: smooth` above on some browsers and doubles the easing.
        className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {shelf.tiles.map((tile) => (
          <div key={tile.id} className="snap-start">
            {shelf.shape === "row" ? (
              <MediaTagChip tile={tile} />
            ) : (
              <MediaTileCard
                tile={tile}
                shape={shelf.shape}
                status={tile.kind === "item" ? statuses?.[tile.id] : undefined}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
