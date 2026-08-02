/**
 * The shapes the website actually renders images at.
 *
 * One definition drives three things that would otherwise drift: the aspect the
 * cropper locks to, the dimensions the server crops to, and the ratio the CSS
 * lays out. If a section's image looks squashed, the fix belongs here — not in
 * three places.
 *
 * Ratios come from the rendered layout at the 1280px column width:
 *   banner   .site-hero-media   1280 x 220
 *   feature  .site-figure       the split-grid photo column
 *   portrait .site-staff-photo  staff card, near-square
 *   video    .site-sermon-stage featured sermon player
 */

export type ImageAspectKey = "banner" | "feature" | "portrait" | "video" | "free";

export type ImageAspect = {
  key: ImageAspectKey;
  label: string;
  /** width / height. Null means the shape is not constrained. */
  ratio: number | null;
  /** What the cropped file is written at. Null means keep the source shape. */
  output: { width: number; height: number } | null;
  hint: string;
};

export const IMAGE_ASPECTS: Record<ImageAspectKey, ImageAspect> = {
  banner: {
    key: "banner",
    label: "Wide banner",
    // Deliberately extreme, because the hero strip really is this shape. The
    // cropper exists precisely so a church chooses which slice survives rather
    // than letting object-fit centre-crop for them.
    ratio: 1280 / 220,
    output: { width: 2400, height: 413 },
    hint: "A wide strip across the top of your page.",
  },
  feature: {
    key: "feature",
    label: "Feature photo",
    ratio: 4 / 3,
    output: { width: 1400, height: 1050 },
    hint: "Sits beside your welcome text.",
  },
  portrait: {
    key: "portrait",
    label: "Portrait",
    ratio: 1,
    output: { width: 900, height: 900 },
    hint: "Square, so every face lines up on the card.",
  },
  video: {
    key: "video",
    label: "Video still",
    ratio: 16 / 9,
    output: { width: 1600, height: 900 },
    hint: "Standard widescreen, like a video thumbnail.",
  },
  free: {
    key: "free",
    label: "Any shape",
    // Logos render with object-fit: contain and must never be cropped — a
    // trimmed wordmark is worse than a letterboxed one.
    ratio: null,
    output: null,
    hint: "Kept as-is, never cropped.",
  },
};

export function getAspect(key: ImageAspectKey | undefined): ImageAspect {
  return IMAGE_ASPECTS[key ?? "free"] ?? IMAGE_ASPECTS.free;
}
