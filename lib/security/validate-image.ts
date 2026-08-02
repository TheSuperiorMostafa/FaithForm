import sharp from "sharp";

export type ValidatedImage = {
  buffer: Buffer;
  contentType: "image/png" | "image/jpeg";
  ext: "png" | "jpg";
};

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
export async function normalizeSiteImage(
  buffer: Buffer,
  options: { maxEdge?: number } = {},
): Promise<ValidatedImage | null> {
  const maxEdge = options.maxEdge ?? 2400;

  try {
    const metadata = await sharp(buffer, { failOn: "error" }).metadata();
    if (!metadata.width || !metadata.height) return null;
    if (!metadata.format || !READABLE_FORMATS.has(metadata.format)) return null;

    // `withoutEnlargement` so a small logo is never upscaled into a blurry mess.
    const pipeline = sharp(buffer)
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true });

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

    if ((format === "jpeg" || format === "jpg") && allowsJpeg) {
      const normalized = await sharp(buffer).rotate().jpeg({ quality: 90 }).toBuffer();
      return { buffer: normalized, contentType: "image/jpeg", ext: "jpg" };
    }

    return null;
  } catch {
    return null;
  }
}
