import { Smartphone } from "lucide-react";

import type { ActivePresentationVersion } from "@/lib/sermons/v1/presentation";
import {
  isPresentationShared,
  isSermonShared,
  SHARE_IN_APP_ANCHOR,
  sermonAudienceLabel,
} from "@/lib/sermons/v1/share-rules";
import type { Sermon } from "@/types/sermon";

/**
 * One line at the top of a sermon page: is it in the FaithForm app, and for
 * whom. The share card itself sits below the deck and the lesson, which is
 * where the pastor finishes the content it shares; this is what makes it
 * findable without scrolling past both.
 */
export function SermonAppStatus({
  sermon,
  canShare,
  presentation = null,
}: {
  sermon: Sermon;
  canShare: boolean;
  presentation?: ActivePresentationVersion | null;
}) {
  const notesShared = isSermonShared(sermon);
  const slidesShared = Boolean(
    presentation && isPresentationShared(presentation),
  );
  const shared = notesShared || slidesShared;
  const audience = sermonAudienceLabel(
    notesShared
      ? sermon.mobile_visibility
      : (presentation?.mobile_visibility ?? null),
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
      <p className="flex items-center gap-2">
        <Smartphone
          className={shared ? "size-4 text-accent" : "size-4 text-muted-foreground"}
          strokeWidth={1.75}
          aria-hidden
        />
        {shared ? (
          <span>
            <span className="font-medium">In the FaithForm app</span>
            {audience && <span className="text-muted-foreground"> · {audience}</span>}
          </span>
        ) : (
          <span className="text-muted-foreground">Not in the FaithForm app yet</span>
        )}
      </p>
      <a
        href={`#${SHARE_IN_APP_ANCHOR}`}
        className="font-medium text-primary underline-offset-4 hover:text-accent hover:underline"
      >
        {!canShare ? "Details" : shared ? "Manage sharing" : "Share in the FaithForm app"}
      </a>
    </div>
  );
}
