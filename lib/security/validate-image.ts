import sharp from "sharp";

export type ValidatedImage = {
  buffer: Buffer;
  contentType: "image/png" | "image/jpeg";
  ext: "png" | "jpg";
};

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
