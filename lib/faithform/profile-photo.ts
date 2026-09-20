import sharp from "sharp";
import { MobileError } from "@/lib/mobile/v1/errors";

export const MAX_PHOTO_BODY_BYTES = 1_500_000;

/** Bound the stream itself, including requests without Content-Length. */
export async function readPhotoBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_PHOTO_BODY_BYTES) {
    throw new MobileError("payload_too_large", "Choose a smaller photo.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new MobileError("invalid_request", "Choose a photo.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PHOTO_BODY_BYTES) {
        await reader.cancel();
        throw new MobileError("payload_too_large", "Choose a smaller photo.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new MobileError("invalid_request", "Choose a valid photo."); }
}

/** Only raster JPEG output is accepted; re-encode to strip GPS/EXIF and other metadata. */
export async function prepareProfilePhoto(base64: unknown): Promise<Buffer> {
  if (typeof base64 !== "string" || base64.length === 0 || base64.length > 1_400_000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new MobileError("invalid_request", "Choose a valid JPEG photo.");
  }
  try {
    const bytes = Buffer.from(base64, "base64");
    const input = sharp(bytes, { limitInputPixels: 4_194_304, failOn: "warning" });
    const metadata = await input.metadata();
    if (metadata.format !== "jpeg" || !metadata.width || metadata.width !== metadata.height || (metadata.pages ?? 1) > 1) {
      throw new Error("Invalid crop");
    }
    return await input.rotate().resize(512, 512).flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer();
  } catch {
    throw new MobileError("invalid_request", "This photo could not be read. Choose another photo.");
  }
}
