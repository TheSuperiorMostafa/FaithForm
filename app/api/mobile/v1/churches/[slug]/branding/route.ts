import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { MobileError } from "@/lib/mobile/v1/errors";
import { saveBrandingImage } from "@/lib/branding/images";
import { churchBrandingContext, readBrandingPhoto } from "@/lib/branding/mobile";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params }) => {
  const { church, canEdit } = await churchBrandingContext(userId, params.slug);
  return { data: { canEdit, logoUrl: church.logo_url, coverUrl: church.cover_image_url } };
});
export const PUT = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const { admin, church, canEdit } = await churchBrandingContext(userId, params.slug);
  if (!canEdit) throw new MobileError("forbidden", "Only church admins can change church images.");
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== "logo" && kind !== "cover") throw new MobileError("invalid_request", "Choose a logo or cover.");
  const bytes = await readBrandingPhoto(request, userId);
  return { data: await saveBrandingImage(admin, { actorUserId: userId, churchId: church.id, kind, previousUrl: kind === "logo" ? church.logo_url : church.cover_image_url }, bytes) };
});
