import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { resolveMemberContext, loadGroupForMember } from "@/lib/groups/context";
import { capabilitiesFor } from "@/lib/groups/permissions";
import { MobileError } from "@/lib/mobile/v1/errors";
import { saveBrandingImage } from "@/lib/branding/images";
import { readBrandingPhoto } from "@/lib/branding/mobile";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const PUT = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const ctx = await resolveMemberContext(userId, params.slug);
  const access = await loadGroupForMember(ctx, params.groupId);
  const caps = capabilitiesFor(access.actor, { memberListVisibility: (access.group.member_list_visibility as "members" | "leaders") ?? "members", status: access.group.status });
  if (!caps.canEditDetails) throw new MobileError("forbidden", "Only group managers can change the group photo.");
  const bytes = await readBrandingPhoto(request, userId);
  return { data: await saveBrandingImage(ctx.admin, { actorUserId: userId, churchId: ctx.church.id, groupId: access.group.id, kind: "cover", previousUrl: access.group.cover_image_url as string | null }, bytes) };
});
