import { MobileError } from "@/lib/mobile/v1/errors";
import { publicRoute } from "@/lib/mobile/v1/handler";
import { readJsonBody } from "@/lib/mobile/v1/protocol";
import { invitationPreviewRequestSchema } from "@/lib/mobile/v1/contract";
import { previewInvitation } from "@/lib/faithful/invitations";

export const dynamic = "force-dynamic";

/**
 * Names the church behind an invitation, before sign-in.
 *
 * Public by necessity — it is read on the signed-out account screens, which is
 * the only moment its answer matters. POST rather than GET so the token travels
 * in a body and never lands in a server log, a Referer header, or a CDN key;
 * `private-no-store` keeps the answer out of every cache for the same reason.
 *
 * Reading an invitation does not spend it: `used_count` is untouched, so a
 * single-use link previewed on the sign-in screen still works when the person
 * finishes creating their account.
 *
 * Every unusable token — expired, revoked, spent, or never real — returns the
 * same 404, so this cannot report on a church's invitation lifecycle to whoever
 * holds a stale link.
 */
export const POST = publicRoute({ cache: "private-no-store" }, async ({ request }) => {
  const parsed = invitationPreviewRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    throw new MobileError("invalid_request", "That invitation link is not valid.");
  }

  const preview = await previewInvitation(parsed.data.token);
  if (!preview) throw new MobileError("not_found", "That invitation is not valid.");

  return { data: preview };
});
