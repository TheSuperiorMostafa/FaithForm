import { computeEtag } from "@/lib/mobile/v1/protocol";
import type {
  SermonDetailDto,
  SermonListItemDto,
} from "@/lib/sermons/v1/sermon-service";

/**
 * Validators for the sermon projections.
 *
 * Both are taken over **everything the response shows**, not over ids and
 * publication versions. The projections read the sermon live — its title, its
 * scripture, its outline, the latest discussion questions, its series name —
 * and none of those edits bump `mobile_publication_version`. A validator built
 * from versions answered "not modified" to a phone holding last week's
 * questions; one built from the payload cannot.
 */

type Scope = "member" | "anonymous";

export function sermonArchiveEtag(input: {
  items: SermonListItemDto[];
  nextCursor: string | null;
  sermonVersion: number;
  /** The raw cursor and query of the request, so each page has its own tag. */
  cursor: string;
  query: string;
  scope: Scope;
}): string {
  return computeEtag({ kind: "sermon-archive", ...input });
}

export function sermonDetailEtag(detail: SermonDetailDto, scope: Scope): string {
  return computeEtag({ kind: "sermon-detail", detail, scope });
}
