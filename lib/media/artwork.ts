/**
 * The shapes media artwork is rendered at, and how a church's upload becomes
 * all three of them.
 *
 * One definition drives four things that would otherwise drift: the aspect the
 * cropper locks to, the dimensions the server writes, the ratio the CSS lays
 * out, and the column the URL lands in. `lib/sites/image-aspects.ts` does the
 * same job for the website; this is deliberately a separate file rather than
 * three more entries in that one, because these ratios come from
 * `design/faithform/tokens.json` and have to stay in step with the generated
 * Swift and Kotlin constants, not with the website's rendered column width.
 */

export type ArtworkCrop = "poster" | "wide" | "banner";

export type ArtworkSpec = {
  key: ArtworkCrop;
  label: string;
  /** width / height, the value the cropper locks to. */
  ratio: number;
  /** Exact output size. Applied after the crop so the result is precise. */
  output: { width: number; height: number };
  /** Said to the church, in the cropper, about where this image will appear. */
  hint: string;
  /** The column on `media_series` and `stream_recordings` this writes to. */
  column: `artwork_${ArtworkCrop}_url`;
};

/**
 * Poster is 4:5 and not 1:1.
 *
 * Square is the more common choice — it is what Subsplash asks for — and it is
 * the safer one, because a square never has to decide between a face and a
 * title. 4:5 is what `tokens.json` already committed to and what the native
 * apps generate constants from, and it is the better shape for the thing these
 * tiles actually are: a vertical shelf card, where the extra height is what
 * makes a row of them read as a library rather than as a grid of avatars.
 */
export const ARTWORK_SPECS: Record<ArtworkCrop, ArtworkSpec> = {
  poster: {
    key: "poster",
    label: "Tile",
    ratio: 4 / 5,
    output: { width: 1000, height: 1250 },
    hint: "The upright card in a shelf. This is the one people scroll past, so it earns the most attention.",
    column: "artwork_poster_url",
  },
  wide: {
    key: "wide",
    label: "Wide still",
    ratio: 16 / 9,
    output: { width: 1920, height: 1080 },
    hint: "Standard widescreen. Used for the featured item, list rows, the website, and TV.",
    column: "artwork_wide_url",
  },
  banner: {
    key: "banner",
    // Not one of the three token aspects, because it is not a media shape — it
    // is page furniture, the strip across the top of a series. Matched to the
    // website's own hero ratio so a church that made one has made both.
    label: "Series banner",
    ratio: 1920 / 696,
    output: { width: 1920, height: 696 },
    hint: "The strip across the top of a series page.",
    column: "artwork_banner_url",
  },
};

export const ARTWORK_CROPS: ArtworkCrop[] = ["poster", "wide", "banner"];

export function getArtworkSpec(key: string | null | undefined): ArtworkSpec | null {
  if (!key) return null;
  return ARTWORK_SPECS[key as ArtworkCrop] ?? null;
}

/** The three crops as a church has actually supplied them. Nulls are normal. */
export type ArtworkSet = {
  poster: string | null;
  wide: string | null;
  banner: string | null;
};

export const EMPTY_ARTWORK: ArtworkSet = { poster: null, wide: null, banner: null };

export function artworkFromRow(row: {
  artwork_poster_url?: string | null;
  artwork_wide_url?: string | null;
  artwork_banner_url?: string | null;
}): ArtworkSet {
  return {
    poster: row.artwork_poster_url ?? null,
    wide: row.artwork_wide_url ?? null,
    banner: row.artwork_banner_url ?? null,
  };
}

/**
 * Resolves what to draw for one item, in the order the SQL projections use.
 *
 * The item's own crop wins, the series supplies the fallback, and `legacyPoster`
 * — the single `mobile_poster_url` field from migration 0060 — is the last
 * resort so recordings published before artwork existed keep the image they had.
 *
 * Kept in TypeScript as well as in SQL on purpose: the dashboard reads
 * `stream_recordings` directly through the church's own session rather than
 * through the `security definer` projections, so it needs the same chain and
 * must not invent a different one.
 */
export function resolveArtwork(
  item: Partial<ArtworkSet> | null,
  series: Partial<ArtworkSet> | null,
  legacyPoster?: string | null,
): ArtworkSet {
  const pick = (crop: ArtworkCrop): string | null =>
    item?.[crop] ?? series?.[crop] ?? null;

  return {
    poster: pick("poster"),
    // Only `wide` falls back to the legacy field. That field held a 16:9 still
    // in practice, so promoting it into the poster slot would stretch a
    // widescreen frame into an upright card.
    wide: pick("wide") ?? legacyPoster ?? null,
    banner: pick("banner"),
  };
}

/**
 * The best available image for a tile that wants a given shape, and the shape
 * it actually got.
 *
 * A caller needs both halves of that answer: a poster tile handed a wide image
 * has to lay itself out as a wide tile rather than crop 16:9 into 4:5 and cut
 * the preacher's head off. Returning null rather than a placeholder URL is
 * deliberate — `tokens.json` is explicit that nothing ships placeholder
 * imagery, and a shelf renders a typographic card when there is no picture.
 */
export function bestArtwork(
  artwork: ArtworkSet,
  preferred: ArtworkCrop,
): { url: string; crop: ArtworkCrop } | null {
  // Ordered by how little damage the substitution does. A banner in a poster
  // slot is the worst case in either direction, so it comes last both times.
  const fallbacks: Record<ArtworkCrop, ArtworkCrop[]> = {
    poster: ["poster", "wide", "banner"],
    wide: ["wide", "banner", "poster"],
    banner: ["banner", "wide", "poster"],
  };

  for (const crop of fallbacks[preferred]) {
    const url = artwork[crop];
    if (url) return { url, crop };
  }
  return null;
}

export function hasAnyArtwork(artwork: ArtworkSet): boolean {
  return Boolean(artwork.poster || artwork.wide || artwork.banner);
}

/**
 * Where an uploaded crop is stored.
 *
 * Shares the public `church-covers` bucket with the website's images, under a
 * `media/` prefix, for the same reasons `uploadSiteImage` gives: the church id
 * leads the path so one church cannot overwrite another's file by guessing a
 * name, and every upload gets a fresh name so replacing artwork does not have
 * to fight CDN caching.
 */
export const ARTWORK_BUCKET = "church-covers";

export function artworkStoragePath(
  churchId: string,
  crop: ArtworkCrop,
  filename: string,
): string {
  return `${churchId}/media/${crop}/${filename}`;
}
