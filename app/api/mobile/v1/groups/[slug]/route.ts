import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { myGroups } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/**
 * The caller's groups at this church, with each conversation's address and
 * whether direct messages are open to them. Everything is derived from the
 * verified account; the slug only names the church, and a church the caller
 * has no relationship with answers 404.
 */
export const GET = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params }) => {
  return { data: await myGroups(userId, params.slug) };
});
