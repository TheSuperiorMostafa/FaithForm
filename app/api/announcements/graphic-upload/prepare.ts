import { normalizeSiteImage, type ValidatedImage } from "@/lib/security/validate-image";

/**
 * 4MB, because that is what actually arrives. Vercel refuses a request body
 * over 4.5MB before the handler runs. Bigger photos are shrunk in the browser
 * (lib/sites/downscale-image.ts) before they are sent.
 */
export const MAX_GRAPHIC_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Long edge of the stored image. Facebook shows feed images at about 1200px.
 * 2048 keeps the small print on a designed flyer sharp without storing a
 * phone's full-size original.
 */
export const GRAPHIC_MAX_EDGE = 2048;

/**
 * Largest file that is stored. Facebook's photo upload takes up to 4MB, and the
 * social-graphics bucket stops at 5MB (migration 0023).
 */
export const GRAPHIC_MAX_STORED_BYTES = 4_000_000;

/** Tried in order, only when the re-encoded image is still too big to store. */
const FALLBACK_EDGES = [GRAPHIC_MAX_EDGE, 1600, 1200];

export type UploadedGraphicType = "image/jpeg" | "image/png" | "image/webp";

export type PrepareGraphicResult =
  | { ok: true; image: ValidatedImage }
  | { ok: false; error: string };

/**
 * What the bytes are, read from their signature.
 *
 * The file name and declared type are only what the browser says. Checking
 * the bytes before any decoder sees them keeps everything except JPEG, PNG and
 * WebP (the three Facebook and the bucket both take) away from the decoder.
 */
export function sniffGraphicType(bytes: Uint8Array): UploadedGraphicType | null {
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...Array.from(bytes.subarray(from, to)));

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(1, 4) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

/**
 * Turns a church's own design into what is stored and posted.
 *
 * Re-encoding strips EXIF, including the GPS position phones attach to
 * photos. It also applies the photo's rotation. The shape is never changed.
 * This is a finished design, and cropping it to Facebook's 1.91:1 would cut
 * off its words, so it is only ever scaled down to fit.
 */
export async function prepareUploadedGraphic(input: Buffer): Promise<PrepareGraphicResult> {
  if (input.byteLength === 0) {
    return { ok: false, error: "Choose an image to upload." };
  }
  if (input.byteLength > MAX_GRAPHIC_UPLOAD_BYTES) {
    return { ok: false, error: "Images must be 4MB or smaller." };
  }
  if (!sniffGraphicType(input)) {
    return { ok: false, error: "Upload a JPG, PNG, or WebP image." };
  }

  for (const maxEdge of FALLBACK_EDGES) {
    const normalized = await normalizeSiteImage(input, { maxEdge });
    if (!normalized) {
      return {
        ok: false,
        error: "We couldn't read that image. Try saving it again as a JPG or PNG.",
      };
    }
    if (normalized.buffer.byteLength <= GRAPHIC_MAX_STORED_BYTES) {
      return { ok: true, image: normalized };
    }
  }

  return {
    ok: false,
    error: "That image is too large to post, even scaled down. Try saving it as a JPG.",
  };
}
