import { imageCropSchema } from "@/lib/branding/images";
import {
  normalizeSiteImage,
  validateImageBuffer,
  type CropRect,
  type ValidatedImage,
} from "@/lib/security/validate-image";
import { IMAGE_ASPECTS } from "@/lib/sites/image-aspects";

/**
 * A cropped source is re-encoded at 1024px before it is stored, so it may be as
 * large as the browser's downscale budget allows — bounded by the 4mb server
 * action body limit in next.config, not by the bucket.
 */
const MAX_CROPPED_SOURCE_BYTES = 4 * 1024 * 1024;
/** An uncropped logo is stored as uploaded, so it must fit the church-logos bucket. */
const MAX_UNCROPPED_BYTES = 2 * 1024 * 1024;

/**
 * Turns an uploaded church logo, and the square the church framed in the
 * cropper, into the image that is stored.
 *
 * Shared by the onboarding and giving uploads, which write to church-logos
 * rather than through saveBrandingImage. The crop is cut here from the file
 * itself, as it is for every other cropped upload, so it lands at the same
 * size the apps and the website builder use.
 */
export async function prepareChurchLogo(
  file: File,
  cropField: FormDataEntryValue | null,
): Promise<{ ok: true; image: ValidatedImage } | { ok: false; error: string }> {
  let crop: CropRect | null = null;
  if (cropField !== null) {
    try {
      crop = imageCropSchema.parse(JSON.parse(String(cropField)));
    } catch {
      return { ok: false, error: "Choose a valid crop for your logo." };
    }
  }

  if (file.size > (crop ? MAX_CROPPED_SOURCE_BYTES : MAX_UNCROPPED_BYTES)) {
    return { ok: false, error: crop ? "Logo must be 4MB or smaller." : "Logo must be 2MB or smaller." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const image = crop
    ? await normalizeSiteImage(buffer, { crop, output: IMAGE_ASPECTS.logo.output })
    : await validateImageBuffer(buffer);
  if (!image) return { ok: false, error: "Logo must be a valid PNG or JPG image." };
  return { ok: true, image };
}
