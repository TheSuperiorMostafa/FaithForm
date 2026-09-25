import Link from "next/link";
import { Play } from "lucide-react";

import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { MediaTile as Tile, ShelfShape } from "@/lib/media/shelves";
import { cn } from "@/lib/utils";

/** A recording's state, shown under its title so a tile never hides it. */
export type TileStatus = { label: string; tone: StatusTone };

/** The CSS aspect for each shape. Mirrors `ARTWORK_SPECS` ratios. */
const SHAPE_RATIO: Record<Exclude<ShelfShape, "row">, string> = {
  poster: "4 / 5",
  wide: "16 / 9",
  banner: "1920 / 696",
};

/** Tile widths per shape. Fixed, because a rail scrolls rather than wraps. */
const SHAPE_WIDTH: Record<Exclude<ShelfShape, "row">, string> = {
  poster: "w-[150px] sm:w-[168px]",
  wide: "w-[240px] sm:w-[272px]",
  banner: "w-[320px] sm:w-[380px]",
};

/**
 * The card a church sees when it has not supplied artwork.
 *
 * Deliberately typographic rather than a grey rectangle with an icon in it.
 * `tokens.json` is explicit that nothing ships placeholder imagery, and a
 * library of identical grey boxes is worse than a library of set titles — the
 * titles are at least readable and tell someone what they are looking at.
 */
function ArtworkFallback({ title, shape }: { title: string; shape: Exclude<ShelfShape, "row"> }) {
  return (
    <div
      aria-hidden="true"
      className="flex size-full items-end bg-muted p-3"
      style={{ aspectRatio: SHAPE_RATIO[shape] }}
    >
      <p
        className={cn(
          "font-heading font-bold leading-tight text-foreground/70",
          shape === "poster" ? "text-sm" : "text-base",
        )}
      >
        {title}
      </p>
    </div>
  );
}

export function MediaTileCard({
  tile,
  shape,
  fluid = false,
  status,
}: {
  tile: Tile;
  shape: Exclude<ShelfShape, "row">;
  /** Fill a wrapping grid column instead of using a rail's fixed card width. */
  fluid?: boolean;
  status?: TileStatus;
}) {
  // When the preferred crop is absent, `bestArtwork` deliberately returns a
  // different shape. Honour it: forcing a 16:9 still through a 4:5 frame is
  // exactly the automatic head-chopping the explicit crop system avoids.
  const renderedShape = tile.artwork?.crop ?? shape;

  return (
    <Link
      href={tile.href}
      className={cn(
        "group flex shrink-0 flex-col gap-2 focus-visible:outline-none",
        fluid ? "w-full" : SHAPE_WIDTH[renderedShape],
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border border-border bg-muted",
          "transition-[border-color,transform] duration-200",
          "group-hover:border-accent/60 group-focus-visible:border-accent",
          "group-focus-visible:ring-2 group-focus-visible:ring-accent/40",
          // No lift on hover. Motion rules in tokens.json rule out
          // attention-seeking movement, and a rail of rising cards is exactly
          // that; the border carries the affordance instead.
        )}
        style={{ aspectRatio: SHAPE_RATIO[renderedShape] }}
      >
        {tile.artwork ? (
          // eslint-disable-next-line @next/next/no-img-element -- church-supplied storage URL
          <img
            src={tile.artwork.url}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <ArtworkFallback title={tile.title} shape={renderedShape} />
        )}

        {tile.badge ? (
          <span className="absolute left-2 top-2 rounded-md bg-background/90 px-2 py-0.5 text-xs font-semibold text-foreground">
            {tile.badge}
          </span>
        ) : null}

        {tile.kind === "item" ? (
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-background/85 text-foreground">
              <Play className="size-4 translate-x-[1px]" strokeWidth={2} />
            </span>
          </span>
        ) : null}

        {/* Progress sits on the artwork, not under the title, so a partially
            watched item reads as watched at a glance in a dense rail. */}
        {tile.progress !== null && tile.progress > 0 ? (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-foreground/20">
            <span
              className="block h-full bg-accent"
              style={{ width: `${Math.round(tile.progress * 100)}%` }}
            />
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="truncate text-[15px] font-semibold text-foreground group-hover:text-accent">
          {tile.title}
        </p>
        {tile.subtitle ? (
          <p className="truncate text-sm text-muted-foreground">{tile.subtitle}</p>
        ) : null}
        {status ? (
          <StatusBadge tone={status.tone} className="mt-1 w-fit max-w-full truncate">
            {status.label}
          </StatusBadge>
        ) : null}
      </div>
    </Link>
  );
}

/** A tag. No artwork, and none coming — a topic shelf is a row of words. */
export function MediaTagChip({ tile }: { tile: Tile }) {
  return (
    <Link
      href={tile.href}
      className={cn(
        "flex min-h-12 shrink-0 flex-col gap-0.5 rounded-xl border border-border bg-card px-4 py-3",
        "shadow-card transition-colors hover:border-accent/60 hover:bg-accent/5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        "dark:shadow-none",
      )}
    >
      <span className="text-[15px] font-semibold text-foreground">{tile.title}</span>
      {tile.subtitle ? (
        <span className="text-sm text-muted-foreground">{tile.subtitle}</span>
      ) : null}
    </Link>
  );
}
