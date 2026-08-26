import type PptxGenJS from "pptxgenjs";
import type { SlideTheme } from "@/lib/sermon-builder/slide-theme-shared";

/**
 * A theme photo ready for pptxgenjs: the base64 payload plus a filename whose
 * extension tells the package writer the real media type of those bytes.
 */
export type ThemeBackgroundImage = {
  data: string;
  path: string;
};

/** The formats PowerPoint's package declares content types for. */
function sniffImageExt(bytes: Buffer): "jpeg" | "png" | "gif" | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpeg";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "gif";
  }
  return null;
}

/**
 * pptxgenjs stores a data-only background as `preencoded.png` regardless of
 * what the bytes are, and its package writer declares no content type at all
 * for WebP. So the filename has to come from the bytes themselves — and a
 * format PowerPoint has no content type for (a church's WebP upload) has to be
 * re-encoded as JPEG rather than shipped as-is.
 */
export async function toThemeBackgroundImage(
  bytes: Buffer,
): Promise<ThemeBackgroundImage | null> {
  let ext = sniffImageExt(bytes);
  let out = bytes;

  if (!ext) {
    try {
      const sharp = (await import("sharp")).default;
      out = await sharp(bytes).jpeg({ quality: 85 }).toBuffer();
      ext = "jpeg";
    } catch {
      // Not an image sharp can read either — the solid-color fallback is
      // better than embedding bytes PowerPoint will refuse.
      return null;
    }
  }

  return {
    data: `data:image/${ext};base64,${out.toString("base64")}`,
    path: `theme-background.${ext}`,
  };
}

/**
 * A fresh object on every call, by design: pptxgenjs converts shadow values to
 * EMU *in place* the first time an options object is used, so one shadow
 * shared across text boxes gets multiplied again on each use until PowerPoint
 * reports the deck as damaged and offers to repair it.
 */
export function imageTextShadow(
  theme: SlideTheme,
): PptxGenJS.ShadowProps | undefined {
  if (theme.backgroundType !== "image" || !theme.textShadow) return undefined;
  return {
    type: "outer",
    color: "000000",
    opacity: 0.65,
    blur: 4,
    offset: 2,
    angle: 135,
  };
}
