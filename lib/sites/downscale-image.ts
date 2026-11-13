/**
 * Shrinks an oversized photo in the browser, before it is handed to a Server
 * Action.
 *
 * Uploads travel as Server Action bodies, and that body has a hard ceiling:
 * Next caps it (see next.config.mjs) and Vercel refuses anything over 4.5MB
 * regardless. A photo straight off a phone is routinely three or four times
 * that, so without this step the request is rejected by the framework and the
 * church sees a raw error rather than any message this app wrote.
 *
 * Quality is not the casualty it sounds like. The server re-encodes every
 * upload anyway, at most 2400px on the long edge and usually to a fixed
 * output size (lib/sites/image-aspects.ts), so the pixels beyond MAX_EDGE
 * were being uploaded only to be thrown away. The cap is set well above those
 * output sizes so a tight crop still has resolution to draw on.
 *
 * Runs in the browser only: it needs canvas and createImageBitmap.
 */

/** Long edge to shrink to. Comfortably above the largest server output (2400px). */
const MAX_EDGE = 3200;

/**
 * Byte budget for the encoded result. Below the 4MB action limit, leaving room
 * for multipart overhead and the crop fields that ride along in the same form.
 */
export const UPLOAD_BUDGET_BYTES = 3_400_000;

/** Successive JPEG qualities to try before shrinking the image further. */
const QUALITY_STEPS = [0.85, 0.72, 0.6];

function fits(file: File): boolean {
  return file.size <= UPLOAD_BUDGET_BYTES;
}

function encode(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function draw(bitmap: ImageBitmap, edge: number): HTMLCanvasElement | null {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const context = canvas.getContext("2d");
  if (!context) return null;

  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function keepTransparency(canvas: HTMLCanvasElement, type: string): boolean {
  if (type === "image/png") return true;
  if (type === "image/jpeg" || type === "image/jpg") return false;
  try {
    const context = canvas.getContext("2d");
    if (!context) return true;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) return true;
    return false;
  } catch {
    // When a browser refuses pixel reads, retaining alpha is safer than
    // silently replacing a church's transparent logo with a black square.
    return true;
  }
}

/**
 * Returns a file small enough to upload, or the original when it already is.
 *
 * Never throws. A format the browser cannot decode, such as HEIC outside
 * Safari, comes back untouched so the server still gets its chance to read it
 * and to answer with a message the church can act on.
 */
export async function downscaleForUpload(file: File): Promise<File> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    // `from-image` bakes in EXIF orientation, so a portrait photo taken
    // sideways is upright in the canvas rather than upright only after the
    // server rotates it. The re-encode drops EXIF along with it, which the
    // server was relying on doing to strip GPS coordinates.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }

  try {
    const oversized = Math.max(bitmap.width, bitmap.height) > MAX_EDGE;
    if (!oversized && fits(file)) return file;

    const firstCanvas = draw(bitmap, MAX_EDGE);
    if (!firstCanvas) return file;
    // Alpha is a property of pixels, not a filename: WebP and AVIF can carry
    // transparent logos too. Opaque phone photos still use efficient JPEG.
    const keepPng = keepTransparency(firstCanvas, file.type);
    const type = keepPng ? "image/png" : "image/jpeg";
    const name = file.name.replace(/\.[^.]+$/, "") + (keepPng ? ".png" : ".jpg");
    const qualities = keepPng ? [1] : QUALITY_STEPS;

    for (const edge of [MAX_EDGE, 2400, 1800]) {
      const canvas = edge === MAX_EDGE ? firstCanvas : draw(bitmap, edge);
      if (!canvas) return file;

      for (const quality of qualities) {
        const blob = await encode(canvas, type, quality);
        if (!blob) return file;

        if (blob.size <= UPLOAD_BUDGET_BYTES) {
          return new File([blob], name, { type, lastModified: file.lastModified });
        }

        // Every step overshot. Hand back whichever is smaller: a re-encode is
        // usually the win, but a PNG that was already well optimised can come
        // back out of the canvas larger than it went in. Either way the field
        // notices it is still over budget and says so.
        const last = edge === 1800 && quality === qualities[qualities.length - 1];
        if (last) {
          return blob.size < file.size
            ? new File([blob], name, { type, lastModified: file.lastModified })
            : file;
        }
      }
    }

    return file;
  } finally {
    bitmap.close();
  }
}
