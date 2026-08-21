import sharp from "sharp";

export type ValidatedImage = {
  buffer: Buffer;
  contentType: "image/png" | "image/jpeg";
  ext: "png" | "jpg";
};

/**
 * Rounds a crop rect to whole pixels and confines it to the image.
 *
 * The cropper returns fractional values, and can hand back a rect a pixel or
 * two outside the bounds at high zoom. sharp treats an out-of-range extract as
 * a hard error, so this is the difference between a working upload and one that
 * fails for reasons the church cannot act on. Returns null when nothing usable
 * is left, letting the caller fall back to the uncropped frame.
 */
function clampCrop(
  crop: { x: number; y: number; width: number; height: number },
  bounds: { width: number; height: number },
): { x: number; y: number; width: number; height: number } | null {
  const x = Math.max(0, Math.min(Math.round(crop.x), bounds.width - 1));
  const y = Math.max(0, Math.min(Math.round(crop.y), bounds.height - 1));
  const width = Math.max(1, Math.min(Math.round(crop.width), bounds.width - x));
  const height = Math.max(1, Math.min(Math.round(crop.height), bounds.height - y));

  // Anything this small is a rounding artefact, not an intended crop.
  if (width < 8 || height < 8) return null;

  return { x, y, width, height };
}

/** Formats sharp can decode that a phone or laptop actually produces. */
const READABLE_FORMATS = new Set([
  "jpeg",
  "jpg",
  "png",
  "webp",
  "avif",
  "heif",
  "gif",
  "tiff",
]);

/**
 * Prepares a church-supplied photo for the public website.
 *
 * Deliberately more permissive than `validateImageBuffer`, which only takes
 * PNG and JPEG: people upload straight from a phone, and those are HEIC or
 * WebP more often than not. Anything sharp can decode is accepted and
 * re-encoded, which also means the output is never the bytes that were
 * uploaded — that is what strips EXIF, including the GPS coordinates phones
 * attach to photos taken at the church.
 *
 * Oversized images are downscaled rather than rejected. A 12MP photo is a
 * normal thing to upload and an unreasonable thing to serve.
 */
export type CropRect = { x: number; y: number; width: number; height: number };

export async function normalizeSiteImage(
  buffer: Buffer,
  options: {
    maxEdge?: number;
    /** Crop rectangle in source-image pixels, from the cropper. */
    crop?: CropRect | null;
    /** Exact output size. Applied after the crop, so the result is precise. */
    output?: { width: number; height: number } | null;
  } = {},
): Promise<ValidatedImage | null> {
  const maxEdge = options.maxEdge ?? 2400;

  try {
    const metadata = await sharp(buffer, { failOn: "error" }).metadata();
    if (!metadata.width || !metadata.height) return null;
    if (!metadata.format || !READABLE_FORMATS.has(metadata.format)) return null;

    let pipeline = sharp(buffer).rotate();

    // `rotate()` applies EXIF orientation, which can swap width and height, so
    // the crop must be clamped against the *post-rotation* dimensions rather
    // than the ones read off the original metadata.
    if (options.crop) {
      const rotated = await sharp(buffer).rotate().toBuffer({ resolveWithObject: true });
      const bounds = { width: rotated.info.width, height: rotated.info.height };

      const rect = clampCrop(options.crop, bounds);
      // A degenerate rect (rounding collapsed it, or it fell entirely outside
      // the image) would make sharp throw. Dropping the crop and keeping the
      // whole frame is a far better outcome than a failed upload.
      if (rect) {
        pipeline = sharp(rotated.data).extract({
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
        });
      }
    }

    if (options.output) {
      // `fit: cover` guarantees the exact output dimensions even if the crop
      // rect drifted by a pixel against the target ratio.
      pipeline = pipeline.resize({
        width: options.output.width,
        height: options.output.height,
        fit: "cover",
        position: "centre",
        withoutEnlargement: false,
      });
    } else {
      // `withoutEnlargement` so a small logo is never upscaled into a blurry mess.
      pipeline = pipeline.resize({
        width: maxEdge,
        height: maxEdge,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    // PNG only survives as PNG when it might carry transparency; everything
    // else becomes JPEG, which is far smaller for photographs.
    if (metadata.format === "png" && metadata.hasAlpha) {
      return {
        buffer: await pipeline.png({ compressionLevel: 9 }).toBuffer(),
        contentType: "image/png",
        ext: "png",
      };
    }

    return {
      buffer: await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer(),
      contentType: "image/jpeg",
      ext: "jpg",
    };
  } catch {
    return null;
  }
}

export async function validateImageBuffer(
  buffer: Buffer,
  allowedTypes: Array<"image/png" | "image/jpeg" | "image/jpg"> = [
    "image/png",
    "image/jpeg",
    "image/jpg",
  ],
): Promise<ValidatedImage | null> {
  try {
    const image = sharp(buffer, { failOn: "error" });
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      return null;
    }

    const format = metadata.format;
    const allowsPng = allowedTypes.includes("image/png");
    const allowsJpeg =
      allowedTypes.includes("image/jpeg") || allowedTypes.includes("image/jpg");

    if (format === "png" && allowsPng) {
      const normalized = await sharp(buffer).rotate().png().toBuffer();
      return { buffer: normalized, contentType: "image/png", ext: "png" };
    }

    if (format === "jpeg" && allowsJpeg) {
      const normalized = await sharp(buffer).rotate().jpeg({ quality: 90 }).toBuffer();
      return { buffer: normalized, contentType: "image/jpeg", ext: "jpg" };
    }

    return null;
  } catch {
    return null;
  }
}
